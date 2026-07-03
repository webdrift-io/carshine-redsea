// Hostinger Node.js Web App entrypoint.
// Keeps the deployment root at the repository root while the Express app
// remains in service-agent/server.js, where the dashboard/API code lives.
require('./service-agent/server.js');
