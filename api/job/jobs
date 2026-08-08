// Vercel serverless entry point for /api/jobs
// Shared logic lives in ./_routes.js (underscore-prefixed files are not
// treated as endpoints by Vercel).
'use strict';
const routes = require('./_routes');
module.exports = (req, res) => routes.handleVercel(req, res, '/api/jobs');

// Raw body access is required: the admin job forms send JSON, but keeping the
// same bodyParser setting as every other endpoint avoids surprises.
module.exports.config = { api: { bodyParser: false } };
