// routes/list-categories.js
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

// Kept in sync with ingest-sms.js's DEFAULT_CATEGORIES — this is the same
// starting taxonomy, so the dropdown always shows real, current options
// rather than a separately hardcoded list that can silently go stale as
// the LLM invents new categories over time.
const DEFAULT_CATEGORIES = [
  'Food & Dining', 'Groceries', 'Transport', 'Shopping', 'Utilities/Bills',
  'Rent/EMI', 'Investments', 'Entertainment', 'Health', 'Transfers',
  'Income', 'Mobile Recharge', 'Insurance', 'Fuel',
];

// GET /api/finance/categories  (behind requireAuth)
export async function listCategoriesHandler(req, res) {
  try {
    const { data } = await supabase.from('merchant_category_map').select('category');
    const learnedCategories = (data || []).map((c) => c.category);

    const categories = [...new Set([...DEFAULT_CATEGORIES, ...learnedCategories])].sort();

    res.json({ categories: [...categories, 'Uncategorized'] });
  } catch (err) {
    console.error('listCategoriesHandler failed:', err);
    res.status(500).json({ error: 'internal error' });
  }
}
