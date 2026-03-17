'use strict';

exports.aceAttribsToClasses = (hookName, args) => {
  const {key, value} = args;
  if (key === 'rz-thread') return [`rz-thread:${value}`];
  if (key === 'rz-task') return [`rz-task:${value}`];
  if (key === 'rz-task-done') return [`rz-task-done:${value}`];
  return [];
};

exports.expressCreateServer = (hookName, {app, padManager}) => {
  // List which line numbers already have a thread sub-pad for a given pad.
  // Thread pads are named  thread--<sanitisedPadId>--line<N>
  app.get('/rizzoma/thread-lines/:padId', async (req, res) => {
    try {
      const padId = req.params.padId;
      const prefix = 'thread--' + padId.replace(/[^a-zA-Z0-9_-]/g, '_') + '--line';
      const {padIDs} = await padManager.listAllPads();
      const lines = padIDs
        .filter((id) => id.startsWith(prefix))
        .map((id) => parseInt(id.slice(prefix.length), 10))
        .filter((n) => !isNaN(n))
        .sort((a, b) => a - b);
      res.json({lines});
    } catch (e) {
      res.status(500).json({error: String(e.message || e)});
    }
  });
};
