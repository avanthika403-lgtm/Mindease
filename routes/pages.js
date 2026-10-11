const express = require('express');

function createPagesRouter() {
  const router = express.Router();

  router.get('/', (req, res) => {
    if (req.user || req.session?.user) return res.redirect('/dashboard');
    res.render('home');
  });

  return router;
}

module.exports = { createPagesRouter };
