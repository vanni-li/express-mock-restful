const fs = require('fs');
const path = require('path');
const bodyParser = require('body-parser');
const pathToRegexp = require('path-to-regexp');
const chalk = require('chalk');
const parse = require('url').parse;

let debug = require('debug')('express:mock');
let logcat = console.log.bind(console, chalk.blue('[MOCK] '));
let mockRouteMap = {};

module.exports = function(options) {
  options = options || {};
  let entry = options.entry;
  if (options.debug) {
    debug = console.log.bind(console, chalk.blue('[MOCK:DEBUG] '));
  }
  if (!entry) {
    throw new Error('Mocker file does not exist!.');
  }
  let watchFile = path.resolve(entry);

  requireFile(watchFile);
  watch(watchFile);

  return function(req, res, next) {
    let route = matchRoute(req);
    if (route) { //match url
      logcat(`${route.method.toUpperCase()} ${route.path}`);
      let bodyParserMethd = bodyParser.json();
      const contentType = req.get('Content-Type');
      if (contentType === 'text/plain') {
        bodyParserMethd = bodyParser.raw({type: 'text/plain'});
      }
      bodyParserMethd(req, res, function() {
        const result = pathMatch(
            {sensitive: false, strict: false, end: false,});
        const match = result(route.path);
        req.params = match(parse(req.url).pathname);
        route.handler(req, res, next);
      });
    } else {
      next();
    }
  };

  function createRoute(mockModule) {
    Object.keys(mockModule).forEach(key => {
      let {method, path} = parseKey(key);
      let handler = mockModule[key];
      let regexp = new RegExp('^' + path.replace(/(:\w*)[^/]/ig, '(.*)') + '$');
      let route;
      if (typeof handler === 'function') {
        route = {
          path: path,
          method: method,
          regexp: regexp,
          handler: mockModule[key],
        };
      } else {
        route = {
          path: path,
          method: method,
          regexp: regexp,
          handler: (req, res) => res.json(mockModule[key]),
        };
      }
      if (!mockRouteMap[method]) {
        mockRouteMap[method] = [];
      }
      mockRouteMap[method].push(route);
    });
    debug('createRoute:\n' + JSON.stringify(mockRouteMap, null, 4));
    logcat('Done: Hot Mocker file replacement success!');
  }

  function watch(watchFile) {
    logcat('watch mock file:' + watchFile);
    //watch file change to create route map
    fs.watchFile(watchFile, {interval: options.interval || 300}, function() {
      requireFile(watchFile);
    });
  }

  function requireFile(watchFile) {
    debug('refresh watch file...');
    try {
      mockRouteMap = {};
      createRoute(require(watchFile));
    } catch (err) {
      logcat('Done: Hot Mocker file replacement failed!\n' +
          chalk.red(err.stack));
    }
  }

  function matchRoute(req) {
    let path = req.url;
    let method = req.method.toLowerCase();
    debug('matchRoute:(path:' + path + '  method:' + method + ')');
    let routerList = mockRouteMap[method];
    return routerList &&
        routerList.find(item => item.path === path || item.regexp.test(path));
  }
};

function parseKey(key) {
  let method = 'get';
  let path = key;
  if (key.indexOf(' ') > -1) {
    let splited = key.split(' ');
    method = splited[0].toLowerCase();
    path = splited[1];
  }
  return {method, path};
}

function pathMatch(options) {
  options = options || {};
  return function(path) {
    let keys = [];
    let re = pathToRegexp(path, keys, options);
    return function(pathname, params) {
      let m = re.exec(pathname);
      if (!m) return false;
      params = params || {};
      let key, param;
      for (let i = 0; i < keys.length; i++) {
        key = keys[i];
        param = m[i + 1];
        if (!param) continue;
        params[key.name] = decodeURIComponent(param);
        if (key.repeat) params[key.name] = params[key.name].split(
            key.delimiter);
      }
      return params;
    };
  };
}