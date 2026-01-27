
    const util = require('util');
    if (!util.isRegExp) {
      util.isRegExp = (obj) => Object.prototype.toString.call(obj) === '[object RegExp]';
    }
  