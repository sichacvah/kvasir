Introduction
============


Our business logic relies on remote data that we need to fetch from
diffrent sources: database, camunda rest, identity service or any third
party APIs, and we can’t mess things up. Kvasir helps to keep code clear
of low-level details while perfoming efficiently:

-   batch multiple requests to the same data source

-   request data from multiple data sources concurrently

-   cache previous requests

Having all this gives you the ability to access remote data sources in a
concise and consistent way, while the library handles batching and
overlapping requests to multiple data sources behind the scenes.

Installation
============

The simplest way to use *kvasir* in javascript project is by run command
below:

    yarn add @uptick/kvasir

or:

    npm install @uptick/kvasir

Limitations
-----------

-   requires Node.js 8.0.0

-   assumes your operations with data sources are "side-effect free", so
    you don’t really care about the order of fetches

-   you need enough memory to store the whole data fetched during a
    single `run` call (in case it’s impossible you should probably look
    into other ways to solve your problem, i.e. data stream libraries)

User Guide
==========

Rationale
---------

A core problem of many systems is balancing expressiveness against
performance.

Let’s imagine the problem of calculating the number of friends in common
that two users have, where we fetch the user data from a remote data
source.

    const {intersection} = require('ramda');

    function friendsOf (id) {
      /* some remote call */
    }

    function countCommon(a, b) {
      return intersection(a, b).length;
    }

    function countCommonFriends(x, y) {
      return countCommon(friendsOf(x), friendsOf(y));
    }

    countCommonFriends(1, 2);

Here, `friendsOf(x)` and `friendsOf(y)` are independent, and you want
them to be fetched concurrently or in a single request. Furthermore, if
`x` and `y` refer to the same person, you don’t want to redundantly
re-fetch their friend list. hat would the code look like if we applied
the mentioned optimizations? We’d have to mix different concerns like
caching and batching together with the business logic we perform with
the data. **Kvasir** allows your data fetches to be implicitly
concurrent with little changes to the original code, here’s a spoiler:

    const kvasir = require('kvasir');

    function countCommonFriends(x, y) {
      return kvasir.map(countCommon, friendsOf(x), friendsOf(y));
    }

    kvasir.run(countCommonFriends(1, 2));

As you may have noticed, Kvasir does so separating the data fetch
declaration from its execution. When running your fetches, `kvasir`
will:

-   request data from multiple data sources concurrently

-   batch multiple requests to the same data source

-   cache repeated requests

Fetching data from remote sources
---------------------------------

We’ll start by writing a small function for emulating data sources with
unpredictable latency.

    function remoteReq(id, result) {
      return new Promise((resolve, reject) => {
        const wait = Math.random() * 1000;
        console.log(`-->[ ${id} ] waiting ${wait} ms`);
        return setTimeout(() => {
          console.log(`<--[ ${id} finished, result: ${result}`);
          return resolve(result);
        }, wait);
      });
    }

Remote data sources
-------------------

Now we define data sources as class that extends Kvasir `DataSource`
type. This class has two methods:

-   `identity`, which returns an identifier for the resource (used for
    caching and deduplication).

-   `fetch`, which fetches the result from the remote data source
    returning a promise.

<!-- -->

    const kvasir = require('kvasir');
    const {range} = require('ramda');

    class FriendsOf extends kvasir.DataSource {
      constructor(id) {
        super();
        this.id = id;
      }

      identity() { return this.id; }

      fetch() { return remoteReq(this.id, range(0, this.id)); }
    }

    function friendsOf(id) {
      return new FriendsOf(id);
    }

Now let’s try to fetch some data with Kvasir.

We’ll use `kvasir.run` for runnig a fetch, it returns a Promise.

    await kvasir.run(friendsOf(10)).then(() => {});

    // -->[ 10 ] waiting 510.23
    // <--[ 10 ] finished, result [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]

Transforming fetched data
-------------------------

We can use `kvasir.map` function for transforming result of a
datasource.

    kvasir.run(kvasir.map(i => i.length, friendsOf(10))).then(console.log);

    // 10


Kvasir inspired by clojure [urania](https://github.com/funcool/urania)
 library
