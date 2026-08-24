import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  'https://sgtjihrzpngktwnpihmx.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNndGppaHJ6cG5na3R3bnBpaG14Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkzNTczMzMsImV4cCI6MjA5NDkzMzMzM30.ZOE8BJbLMuS72k2OzOKlV-sD34Fy8punld3pJzV9dv8'
);

// Fetch all bills with a cancel_line value
const { data, error } = await supabase
  .from('bills')
  .select('id,bill_no,cancel_line,payment_mode')
  .not('cancel_line', 'is', null)
  .neq('cancel_line', '');

if (error) { console.error('Fetch error:', error); process.exit(1); }

const bad = data.filter(r => { const n = Number(r.cancel_line); return Number.isInteger(n) && n >= 1000; });
const good = data.filter(r => { const n = Number(r.cancel_line); return Number.isInteger(n) && n > 0 && n < 1000; });

console.log(`\nBAD (>= 1000, will be cleared): ${bad.length}`);
bad.forEach(r => console.log(`  bill_no=${r.bill_no}  cancel_line=${r.cancel_line}  mode=${r.payment_mode}`));

console.log(`\nGOOD (< 1000, real sequence): ${good.length}`);
good.forEach(r => console.log(`  bill_no=${r.bill_no}  cancel_line=${r.cancel_line}  mode=${r.payment_mode}`));

if (bad.length === 0) { console.log('\nNothing to clear.'); process.exit(0); }

// Clear cancel_line for all bad entries
const badIds = bad.map(r => r.id);
const { error: updateErr } = await supabase
  .from('bills')
  .update({ cancel_line: '' })
  .in('id', badIds);

if (updateErr) { console.error('Update error:', updateErr); process.exit(1); }

console.log(`\n✅ Cleared cancel_line for ${bad.length} bills with >= 1000 ref nos.`);
