// services/supabase.js
// Single shared Supabase client. Always uses the service_role key —
// this backend is the only thing that ever talks to Supabase directly;
// students never hold Supabase credentials. RLS on every table (see
// schema.sql) is defense-in-depth, not the primary access control.

const { createClient } = require('@supabase/supabase-js');

const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceKey) {
  console.warn(
    '[shalakasi] SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set — set them in .env before starting the server.'
  );
}

const supabase = createClient(url, serviceKey, {
  auth: { persistSession: false },
});

module.exports = supabase;
