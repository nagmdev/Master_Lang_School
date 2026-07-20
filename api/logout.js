// Vercel serverless entry point for /api/logout
// Shared logic lives in ./_routes.js (underscore-prefixed files are not
// treated as endpoints by Vercel).
'use strict';
const routes = require('./_routes');
module.exports = (req, res) => routes.handleVercel(req, res, '/api/logout');

// Raw body access is required: the multipart parser needs the original bytes,
// and Vercel's default JSON body parsing would corrupt uploaded documents.
module.exports.config = { api: { bodyParser: false } };
