import { getSession } from "../utils/session.js";

function requireAuthPage(req, res, next) {
  const token = req.cookies.session;
  const session = token && getSession(token);
  if (!session) {
    console.log("Unauthorized access attempt to /upload-file");
    return res.redirect('/login'); // send them to the login page instead of a bare 401
  }
  next();
}

export default requireAuthPage;