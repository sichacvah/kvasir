const Kvasir = require('../lib/index');
const R      = require('ramda');


function range(num) {
  let arr = [];
  for (let i = 0; i<num; i++) {
    arr.push(i);
  }
  return arr;
}

function remoteReq(id, result) {
  console.log("ID", id);
  return new Promise((resolve, reject) => {
    const wait = Math.random() * 1000;
    console.log("-->[ " + id + " ] waiting " + wait);
    setTimeout(() => {
      console.log("<--[ " + id + " ] finished, result: " +  Array.from(result));
      resolve(result);
    }, wait);
  });
}

class FriendsOf extends Kvasir.DataSource {
  constructor(id) {
    super();
    this.id = id;
  }

  identity() {
    return this.id;
  }

  fetch() {
    return remoteReq(this.id, new Set(range(this.id)));
  }
}

function friendsOf(id) {
  return new FriendsOf(id);
}

class ActivitySource extends Kvasir.DataSource {
  constructor(id) {
    super();
    this.id = id;
  }

  identity() {
    return this.id;
  }

  fetch() {
    const id = this.id;
    return remoteReq(id, id + 1);
  }
}

function activity(id) {
  return new ActivitySource(id);
}

function firstFriendsActivity(id) {
  return Kvasir.mapcat((friends) => activity(Array.from(friends)[0]), friendsOf(id));
}

function friendsActivity(id) {
  return Kvasir.mapcat(
    (friendsSet) => {
      const friends = Array.from(friendsSet);
      return Kvasir.collect(friends.map(activity));
    },
    friendsOf(id)
  );
}

class BatchedActivitySource extends Kvasir.DataSource {
  constructor(id) {
    super();
    this.id = id;
  }

  identity() {
    return this.id;
  }

  fetch() {
    const id = this.id;
    return remoteReq(id, id + 1);
  }

  fetchMulti(scores, env) {
    const ids = R.prepend(this.id, R.map(score => score.id, scores));
    return remoteReq(ids, R.zipObj(ids, R.map(R.inc, ids)));
  }
}

function batchedActivity(id) {
  return new BatchedActivitySource(id);
}

function batchedFirstFriendsActivity(id) {
  return Kvasir.mapcat((friends) => batchedActivity(Array.from(friends)[0]), friendsOf(id));
}

function batchedFriendsActivity(id) {
  return Kvasir.mapcat(
    (friendsSet) => {
      const friends = Array.from(friendsSet);
      return Kvasir.collect(friends.map(batchedActivity));
    },
    friendsOf(id)
  );
}

class Pet extends Kvasir.DataSource {
  constructor(id) {
    super();
    this.id = id;
  }

  identity() {
    return this.id
  }

  fetch() {
    const id = this.id;
    return remoteReq(id, "DOG");
  }
}

function pet(id) {
  return new Pet(id);
}

const isEven = n => n % 2 === 0;

function fetchPet(usr) {
  if (isEven(usr)) {
    return pet(usr);
  }
  return Kvasir.value("NO_PET");
}

function friendsWithPets(id) {
  return Kvasir.traverse(fetchPet, friendsOf(id));
}

test('run with one DataSource', async () => {
  await expect(Kvasir.run(friendsOf(10))).resolves.toEqual(new Set([ 0, 1, 2, 3, 4, 5, 6, 7, 8, 9 ]));
});

test('dependencies between results', async () => {
  await expect(Kvasir.run(firstFriendsActivity(10))).resolves.toEqual(1);
});

test('collect list of each user friend activity', async () => {
  await expect(Kvasir.run(friendsActivity(5))).resolves.toEqual([1, 2, 3, 4, 5]);
});

test('collect are fetched concurrently', async () => {
  await expect(Kvasir.run(Kvasir.collect([friendsOf(1), friendsOf(2), friendsOf(2)]))).resolves.toEqual([ new Set([0]), new Set([0, 1]), new Set([0, 1]) ]);
});

test('collect batched source', async () => {
  await expect(Kvasir.run(batchedFriendsActivity(5))).resolves.toEqual([1, 2, 3, 4, 5]);
});

test('fetching data conditionaly', async () => {
  await expect(Kvasir.run(friendsWithPets(3))).resolves.toEqual(["DOG", "NO_PET", "DOG"]);
});