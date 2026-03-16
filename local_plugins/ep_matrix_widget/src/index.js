/**
 * ep_matrix_widget - Server-side hooks
 *
 * Exposes a /matrix-widget/:padId route that serves the pad as a Matrix widget,
 * and adds the client-side JS via Etherpad's hook system.
 */

'use strict';

exports.expressCreateServer = (hookName, args) => {
  const {app} = args;

  // Matrix widget manifest endpoint (for widget registration in Matrix clients)
  app.get('/matrix-widget-manifest', (req, res) => {
    res.json({
      name: 'Kunplanejo',
      type: 'm.custom',
      url: `${req.protocol}://${req.get('host')}/p/$matrix_room_id`,
      creatorUserId: '$matrix_user_id',
      data: {
        title: 'Kunplanejo collaborative editor',
        description: 'Wave-style collaborative editor with Matrix integration',
      },
    });
  });
};

// No server-side hooks needed beyond the route above
exports.hooks = {};
