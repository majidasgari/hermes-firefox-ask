// jsdom lookup for the tests: use an installed one, else JSDOM_PATH (e.g. a Hermes checkout).
'use strict';

function loadJsdom() {
  try {
    return require('jsdom');
  } catch (err) {
    const fallback = process.env.JSDOM_PATH;
    if (fallback) return require(fallback);
    throw new Error(
      'jsdom not found. Run `npm i jsdom` in this folder, or point JSDOM_PATH at a jsdom package directory.'
    );
  }
}

module.exports = loadJsdom();
