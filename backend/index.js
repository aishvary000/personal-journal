import "dotenv/config";
import express from "express";
import bcrypt from "bcryptjs";
import cookieParser from "cookie-parser";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import {createSession, destroySession, getSession, SEVEN_DAYS_MS} from "./utils/session.js";
import requireAuthPage from "./middlewares/requireAuth.js";
import rateLimit from "express-rate-limit";
import cors from "cors";
import { photosInRangeHandler } from './routes/photosInRangeHandler.js';


const app = express();

const corsOptions = { origin: ['https://personal-journal.aishvary.dev', 'http://localhost:5173'], credentials: true, }; 
app.options('*', cors(corsOptions)); 
app.use(cors(corsOptions));
app.use(express.json());
app.use(cookieParser());


const {
  B2_KEY_ID,
  B2_APP_KEY,
  B2_BUCKET,
  B2_REGION,
  B2_ENDPOINT,
  BACKUP_API_KEY,
  PORT = 3000,
} = process.env;

for (const [name, val] of Object.entries({
  B2_KEY_ID, B2_APP_KEY, B2_BUCKET, B2_REGION, B2_ENDPOINT, BACKUP_API_KEY,
})) {
  if (!val) {
    console.error(`Missing required env var: ${name}. Copy .env.example to .env and fill it in.`);
    process.exit(1);
  }
}

const s3 = new S3Client({
  region: B2_REGION,
  endpoint: B2_ENDPOINT,
  credentials: {
    accessKeyId: B2_KEY_ID,
    secretAccessKey: B2_APP_KEY,
  },
});

// --- auth: every request must carry the shared secret ---
function requireApiKey(req, res, next) {
  const key = req.header("x-api-key");
  if (!key || key !== BACKUP_API_KEY) {
    return res.status(401).json({ error: "unauthorized" });
  }
  next();
}

// --- basic key validation so callers can't write outside the intended prefix ---
function isValidKey(key) {
  if (typeof key !== "string" || key.length === 0 || key.length > 800) return false;
  if (key.includes("..")) return false; // no path traversal
  if (key.startsWith("/")) return false;
  return true;
}

app.get("/api/health", (req, res) => res.json({ ok: true }));


app.post("/api/presign-upload", requireApiKey, async (req, res) => {
  const { key, contentType } = req.body || {};

  if (!isValidKey(key)) {
    return res.status(400).json({ error: "invalid key" });
  }
  if (typeof contentType !== "string" || contentType.length === 0) {
    return res.status(400).json({ error: "contentType required" });
  }

  try {
    const command = new PutObjectCommand({
      Bucket: B2_BUCKET,
      Key: key,
      ContentType: contentType,
    });

    const expiresIn = 300; // 5 minutes -- plenty for a mobile upload to start
    const uploadUrl = await getSignedUrl(s3, command, { expiresIn });

    res.json({ uploadUrl, expiresIn, key });
  } catch (err) {
    console.error("presign error:", err);
    res.status(500).json({ error: "failed to generate presigned url" });
  }
});

  const loginLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 5, // limit each IP to 5 requests per windowMs
    message: { error: "Too many login attempts. Please try again later." },
    standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
    legacyHeaders: false, // Disable the `X-RateLimit-*` headers
  });

app.post("/api/login", loginLimiter, async (req, res) => {

  const { password } = req.body || {};
  if (typeof password !== "string" || password.length === 0) {
    return res.status(400).json({ error: "password required" });
  }

  const hashedPassword = process.env.ADMIN_HASHED_PASSWORD;

  const match = await bcrypt.compare(password, hashedPassword);
  if (!match) {
    return res.status(401).json({ error: "invalid password" });
  }

  // Password is correct, create a session token
  const token = createSession();
  res.set('cache-control','no-store');
  res.cookie("session", token, { httpOnly: true,secure:process.env.NODE_ENV === "production", maxAge: SEVEN_DAYS_MS,sameSite:'lax',path:'/' }); // 7 days
  res.json({ ok: true });
});

app.post("/api/upload-file", requireAuthPage, (req, res) => {
  res.json({ ok: true });
});

app.get('/api/me', (req, res) => {
  const token = req.cookies?.session;
  console.log("Checking session for token:", token);
  const session = token && getSession(token);
  res.json({ authenticated: !!session });
});

app.post("/api/logout", (req, res) => {
  const token = req.cookies?.session;
  if (token) {
    destroySession(token);
    res.clearCookie("session");
  }
  res.json({ ok: true });
});

app.get('/api/photos', requireAuthPage, photosInRangeHandler);



app.listen(PORT, () => {
  console.log(`Presign server listening on port ${PORT}`);
});