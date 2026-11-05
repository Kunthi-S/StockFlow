// Log the real error; send the browser a generic message (no SQL details)
function fail(res, err) {
  console.error(err);
  // The view-only account cannot write
  if (err.code === 'ER_TABLEACCESS_DENIED_ERROR' || err.code === 'ER_PROCACCESS_DENIED_ERROR') {
    return res.status(403).json({ error: 'View-only access: this account cannot change data.' });
  }
  res.status(500).json({ error: 'Something went wrong. Please try again later.' });
}

// ?q= search text as a LIKE value: the % goes in the value, never in the SQL
const like = (q) => '%' + String(q ?? '').trim() + '%';

module.exports = { fail, like };
