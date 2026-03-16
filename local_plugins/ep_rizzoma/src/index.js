/**
 * ep_rizzoma - Server-side hooks
 *
 * Provides wave-style features inspired by Rizzoma:
 *  - Thread/discussion markers stored as pad attributes
 *  - Task annotations ([ ] / [x] style with author + due date)
 *  - A REST endpoint for fetching thread data as JSON
 */

'use strict';

// Register custom attributes for serialization
exports.aceAttribsToClasses = (hookName, args) => {
  const {key, value} = args;
  if (key === 'rz-thread') return [`rz-thread:${value}`];
  if (key === 'rz-task') return [`rz-task:${value}`];
  if (key === 'rz-task-done') return [`rz-task-done:${value}`];
  if (key === 'rz-reply-to') return [`rz-reply-to:${value}`];
  return [];
};

exports.expressCreateServer = (hookName, {app, padManager}) => {
  // GET /rizzoma/threads/:padId - return thread annotations as JSON
  app.get('/rizzoma/threads/:padId', async (req, res) => {
    try {
      const pad = await padManager.getPad(req.params.padId);
      const apool = pad.pool;
      const text = pad.text();

      const threads = extractAnnotations(text, apool, 'rz-thread');
      const tasks = extractAnnotations(text, apool, 'rz-task');

      res.json({padId: req.params.padId, threads, tasks});
    } catch (e) {
      res.status(404).json({error: e.message});
    }
  });
};

function extractAnnotations(text, apool, attrKey) {
  // Placeholder: in production this would walk the changeset attribute pool
  // and extract ranges with the given attribute key.
  return [];
}
