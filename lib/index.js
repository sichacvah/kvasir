const R = require('ramda');


/**
 * @class Executor
 * A policy for executing task.
 */
class Executor {
  execute(task) {
    throw new Error('Not implemented execute method');
  }
}


/**
 * @class DataSource
 * A remote data source.
 */
class DataSource {
  identity() {
    throw new Error('indenty not implemeted in DataSource');
  }

  fetch(env) {
    throw new Error('fetch not implemeted in DataSource');
  }
}


/**
 * @class Cache
 * A lookup for previously fetched responses
 */
class Cache {
  constructor(cache) {
    this.cache = cache;
    this.into = this.into.bind(this);
    this.get  = this.get.bind(this);
  }

  get(rName, cacheId, notFound) {
    return _get(this.cache, rName, cacheId, notFound);
  }

  into(responsesByResourceName) {
    return new Cache(_into(this.cache, responsesByResourceName));
  }
}


class Done {
  constructor(value) {
    this.value = value;
    
    this.composeAST = this.composeAST.bind(this);
    this.children   = this.children.bind(this);
    this.isDone     = this.isDone.bind(this);
    this.inject     = this.inject.bind(this);
  }

  composeAST(f2) {
    return new Done(this.value);
  }

  children() { return null; }
  isDone() { return true; }
  inject() { return this; }
}

class Map {
  constructor(f, values) {
    this.f = f;
    this.values = values;
    
    this.composeAST = this.composeAST.bind(this);
    this.children   = this.children.bind(this);
    this.isDone     = this.isDone.bind(this);
    this.inject     = this.inject.bind(this);
  }

  composeAST(f2) {
    return new Map(R.compose(f2, this.f), this.values);
  }

  children() {
    return this.values;
  }

  isDone() {
    return false;
  }

  inject(env) {
    const f = this.f;
    const values = this.values;
    const next = R.map((v) => _injectInto(env, v), values);

    if (R.all(i => i.isDone(), next)) {
      return new Done(f.apply(null, R.map(n => n.value, next)));
    }
    return new Map(f, next);
  }
}


function isAST(ast) {
  // REWRITE TO interfaces with Symbols
  return (ast instanceof DataSource || (typeof ast.children === 'function' && typeof ast.isDone === 'function' && typeof ast.inject === 'function'));
}

function assertAST(ast) {
  if (!isAST(ast)) {
    throw new Error('Not is ast ', ast);
  }
  return void 0;
}

class FlatMap {
  constructor(f, vs) {
    this.f = f;
    this.values = vs;
    this.children   = this.children.bind(this);
    this.isDone     = this.isDone.bind(this);
    this.inject     = this.inject.bind(this);
  }

  // AST

  children() {
    return this.values;
  }

  isDone() {
    return false;
  }

  inject(env) {
    const f = this.f;
    const values = this.values;
    const next = R.map((v) => _injectInto(env, v), values);
    if (R.all(n => n.isDone(), next)) {
      const result = _injectInto(env, f.apply(null, R.map(n => n.value, next)));
      if (result instanceof DataSource) return new Map(R.identity, [result]);
      return result;
    }
    return new FlatMap(f, next);
  }

}


class Value {
  constructor(v) {
    this.value = v;
    this.composeAST = this.composeAST.bind(this);
    this.children   = this.children.bind(this);
    this.isDone     = this.isDone.bind(this);
    this.inject     = this.inject.bind(this);
  }

  // ComposedAST
  composeAST(f2) {
    const {value} = this;
    return new Map(f2, [value])
  }

  // AST
  children() {
    return [this.value];
  }

  isDone() {
    return false;
  }

  inject(env) {
    const next = _injectInto(env, value);
    if (next.isDone()) return new Done(next.value);
    return next;
  }
}

function resourceName(v) {
  return v.constructor.name;
}


function cacheId(res) {
  return res.identity();
}

/**
 * @function value
 * @description Given a plain value, wrap it in a data source that will return the value immediately.
 * @param {*} value 
 */
function value(v) {
  if (isAST(v)) {
    throw new Error('The value is already an AST: ', v);
  }
  return new Done(v);
}

/**
 * @description Given a function and one or more data sources, return a new
 * data source that will apply the given function to the results.
 * When mapping over multiple data sources the results will be passed
 * as positional arguments to the given function.
 * @param {Function} f
 * @param {AST|CombinedAST} muse 
 * @param {Array.<AST|CombinedAST>} muses 
 */
function map(f, muse, ...muses) {
  console.log('MUSE', muse);
  if (muses.length === 0 && typeof muse.composeAST === 'function') {
    return muse.composeAST(f);
  }
  return new Map(f, R.prepend(muse, muses));
}


/**
 * @description Given a function and one or more data sources, return a new data
 * source that will apply the given function to the results. The function
 * is assumed to return more data sources that will be flattened into a single
 * data source.
 * @param {Function} fn
 * @param {AST|CombinedAST} muse 
 * @param {Array.<AST|CombinedAST>} muses 
 */
function mapcat(f, muse, ...muses) {
  return new FlatMap(f, R.prepend(muse, muses));
}

/**
 * @description Given a collection of data sources, return a new data source that will
 * contain a collection with the values of every data source when fetched.
 * @param {Array.<AST|CombinedAST>} muses 
 */
function collect(muses) {
  if (muses && muses.length > 0) {
    return map((...i) => i, ...muses);
  }
  return value([]);
}

/**
 * @description Given a function and a collection of data sources, apply the function once
 * to each data source and collect the resulting data source results into a data
 * source with every result.
 * @param {Function} fn 
 * @param {Array.<AST|CombinedAST>} muses 
 */
function traverse(f, muses) {
  return mapcat((muse) => {
    const museArr =  (typeof muse.map === 'function' ? muse : Array.from(muse));
    return collect(R.map(f, museArr));
  }, muses);
}

function _runFetch({executor, env}, muse) {
  return new Promise((resolve, reject) => {
    executor.execute(() => {
      return muse.fetch(env).then(resolve).catch(reject);
    })
  });
}


function _runFetchMulti({executor, env}, muse, muses) {
  return new Promise((resolve, reject) => 
    executor.execute(() => muse.fetchMulti(muses, env).then(resolve).catch(reject))
  );
}

function _fetchManyCaching(opts, sources) {
  const ids = R.map(cacheId, sources);
  const responses = R.map(s => _runFetch(opts, s), sources);

  return Promise.all(responses).then((results) => R.zipObj(ids, results));
}

function _fetchOneCaching(opts, source) {
  return _runFetch(opts, source)
    .then(res => R.assoc(cacheId(source), res, {}));
}


function _fetchSources(opts, sources) {
  const head = R.head(sources);
  const tail = R.tail(sources);

  if (tail.length === 0) {
    return _fetchOneCaching(opts, head);
  }
  if (typeof head.fetchMulti === 'function') {
    return _runFetchMulti(opts, head, tail);
  }
  return _fetchManyCaching(opts, sources);
}

function dedupeSources(sources) {
  const s = R.pipe(
    R.groupBy(cacheId),
    R.values,
    R.map(R.head),
  )(sources);
  return s;
}

function  _fetchResource(opts, [rName, sources]) {
  return _fetchSources(opts, dedupeSources(sources))
    .then(resp => [rName, resp]);
}

function _mapcat(fn, coll) {
  if (!coll) {
    return (...colls) => _mapcat(fn, ...colls);
  }
  const r = R.reduce(R.concat, [], R.map(fn, coll).filter(Boolean));
  return r;
}

function nextLevel(astNode) {
  if (astNode instanceof DataSource) {
    return [astNode];
  }
  const values = astNode.children();
  if (!values) return;
  return _mapcat(nextLevel, values);
}

function _cachedOr(env, res) {
  const cache = R.prop('cache', env);
  const cached = cache.get(resourceName(res), cacheId(res), "notFound");
  if (cached === "notFound") {
    return new Map(R.identity, [res]);
  }
  return new Done(cached);
}

function _injectInto(env, node) {
  if (node instanceof DataSource) {
    return _cachedOr(env, node);
  }
  return node.inject(env);
}

function interpretAST(astNodeRaw, opts, onSuccess, onError) {
  const {cache} = opts;
  const astNode = _injectInto(opts, astNodeRaw);
  const requests = nextLevel(astNode);
  if (!requests || requests.length === 0) {
    if (astNode.isDone()) {
      return onSuccess([astNode.value, cache]);
    }
    return interpretAST(astNode, opts, onSuccess, onError);
  }
  const requestsByType = R.groupBy(resourceName, requests);
  const responses      = R.map((i) => _fetchResource(opts, i), R.toPairs(requestsByType));
  return Promise.all(responses)
    .then(results => {
      const nextCache = cache.into(R.fromPairs(results));
      const nextOpts  = R.assoc("cache", nextCache, opts);

      return interpretAST(astNode, nextOpts, onSuccess, onError);
    })
    .catch(onError);
}


function _into(cache, responsesByResourceName) {
  return R.mergeWith(R.merge, cache, responsesByResourceName);
}

function _get(cache, rName, cacheId, notFound) {
  const res = R.path([rName, cacheId], cache);
  if (!res) return notFound;
  return res;
}


class DefaultExecutor extends Executor {
  execute(task) {
    return setTimeout(() => task(), 0);
  }
}

const runDefaults = {
  cache: new Cache({}),
  executor: new DefaultExecutor()
};


/**
 * @description Executes the data fetching, returning a promise of the `[cache result]`
 * pair.
 *  - fetch data sources concurrently (when possible)
 *  - cache result of previously made fetches
 *  - batch calls to the same data source (when applicable)
 * 
 * You can pass a second argument with the following options:
 * - `cache` A object to use as the cache.
 * - `executor` A Exector
 * - `env` An environment that will be passed to every data fetching function.
 * @param {Object} ast 
 * @param {Object} opts 
 */
function execute(ast, opts = runDefaults) {
  return new Promise((resolve, reject) => interpretAST(ast, R.merge(runDefaults, opts), resolve, reject));
}

/**
 * @description Executes the data fetching, returning a promise of the `[cache result]`
 * pair.
 *  - fetch data sources concurrently (when possible)
 *  - cache result of previously made fetches
 *  - batch calls to the same data source (when applicable)
 * 
 * You can pass a second argument with the following options:
 * - `cache` A object to use as the cache.
 * - `executor` A Exector
 * - `env` An environment that will be passed to every data fetching function.
 * @param {Object} ast
 * @param {Object} opts
 */
function run(ast, opts = runDefaults) {
  return execute(ast, opts).then((results) => R.head(results));
}


module.exports = {
  DataSource,
  run,
  execute,
  Executor,
  Cache,
  map,
  mapcat,
  collect,
  traverse,
  value
};