import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  ChangeQueue,
  DecorationBuckets,
  DeferredAppends,
  oncePerFrame,
} from "../src/layoutBatching.mjs";

function recordingParent(name, log) {
  return {
    append(child) {
      log.push(`${name}<-${child}`);
    },
  };
}

describe("DeferredAppends", () => {
  it("appends straight away outside a run", () => {
    const log = [];
    const appends = new DeferredAppends();

    appends.append(recordingParent("body", log), "group");

    assert.deepEqual(log, ["body<-group"]);
  });

  it("applies nothing until the build finishes, then everything in order", () => {
    const log = [];
    const appends = new DeferredAppends();
    const body = recordingParent("body", log);
    const group = recordingParent("group", log);

    appends.run(() => {
      appends.append(body, "group");
      appends.append(group, "item-1");
      appends.append(group, "item-2");
      assert.deepEqual(log, []);
    });

    assert.deepEqual(log, ["body<-group", "group<-item-1", "group<-item-2"]);
  });

  it("still applies what was built when the build throws", () => {
    const log = [];
    const appends = new DeferredAppends();
    const group = recordingParent("group", log);

    assert.throws(() =>
      appends.run(() => {
        appends.append(group, "item-1");
        throw new Error("stale range");
      })
    );

    assert.deepEqual(log, ["group<-item-1"]);
    appends.append(group, "item-2");
    assert.deepEqual(log, ["group<-item-1", "group<-item-2"]);
  });

  it("lets a nested run join the outer one", () => {
    const log = [];
    const appends = new DeferredAppends();
    const group = recordingParent("group", log);

    appends.run(() => {
      appends.run(() => appends.append(group, "inner"));
      assert.deepEqual(log, []);
      appends.append(group, "outer");
    });

    assert.deepEqual(log, ["group<-inner", "group<-outer"]);
  });
});

describe("oncePerFrame", () => {
  function fakeFrames() {
    const queued = [];
    return {
      requestFrame: (callback) => queued.push(callback),
      flush() {
        const callbacks = queued.splice(0);
        callbacks.forEach((callback) => callback());
      },
      get pending() {
        return queued.length;
      },
    };
  }

  it("runs once on the next frame however often it is called", () => {
    const frames = fakeFrames();
    let runs = 0;
    const schedule = oncePerFrame(() => runs++, frames.requestFrame);

    schedule();
    schedule();
    schedule();

    assert.equal(runs, 0);
    assert.equal(frames.pending, 1);
    frames.flush();
    assert.equal(runs, 1);
  });

  it("schedules again once the frame has run", () => {
    const frames = fakeFrames();
    let runs = 0;
    const schedule = oncePerFrame(() => runs++, frames.requestFrame);

    schedule();
    frames.flush();
    schedule();
    frames.flush();

    assert.equal(runs, 2);
  });
});

describe("ChangeQueue", () => {
  function fakeFrames() {
    const queued = [];
    return {
      requestFrame: (callback) => queued.push(callback),
      flush() {
        queued.splice(0).forEach((callback) => callback());
      },
      get pending() {
        return queued.length;
      },
    };
  }

  it("applies an immediate change at once", () => {
    const frames = fakeFrames();
    const log = [];
    const queue = new ChangeQueue(frames.requestFrame);

    queue.run(() => log.push("next word"), true);

    assert.deepEqual(log, ["next word"]);
    assert.equal(frames.pending, 0);
  });

  it("holds other changes for the next frame", () => {
    const frames = fakeFrames();
    const log = [];
    const queue = new ChangeQueue(frames.requestFrame);

    queue.run(() => log.push("restore"), false);
    queue.run(() => log.push("clear"), false);

    assert.deepEqual(log, []);
    assert.equal(frames.pending, 1);
    frames.flush();
    assert.deepEqual(log, ["restore", "clear"]);
  });

  it("keeps an immediate change behind the ones waiting for the frame", () => {
    const frames = fakeFrames();
    const log = [];
    const queue = new ChangeQueue(frames.requestFrame);

    queue.run(() => log.push("clear"), false);
    queue.run(() => log.push("next word"), true);

    assert.deepEqual(log, []);
    frames.flush();
    assert.deepEqual(log, ["clear", "next word"]);
    queue.run(() => log.push("word after"), true);
    assert.deepEqual(log, ["clear", "next word", "word after"]);
  });

  it("says whether it is applying the frame's changes", () => {
    const frames = fakeFrames();
    const seen = [];
    const queue = new ChangeQueue(frames.requestFrame);

    queue.run(() => seen.push(queue.inFrame), true);
    queue.run(() => seen.push(queue.inFrame), false);
    frames.flush();

    assert.deepEqual(seen, [false, true]);
    assert.equal(queue.inFrame, false);
  });

  it("applies the rest of the frame's changes when one throws", () => {
    const frames = fakeFrames();
    const log = [];
    const failures = [];
    const queue = new ChangeQueue(frames.requestFrame, (error) =>
      failures.push(error.message)
    );

    queue.run(() => {
      throw new Error("stale range");
    }, false);
    queue.run(() => log.push("next word"), false);
    frames.flush();

    assert.deepEqual(log, ["next word"]);
    assert.deepEqual(failures, ["stale range"]);
    assert.equal(queue.inFrame, false);
  });
});

describe("DecorationBuckets", () => {
  function recordingBuckets(capacity) {
    const created = [];
    const removed = [];
    const buckets = new DecorationBuckets((zIndex) => {
      const name = `bucket-${created.length}@${zIndex}`;
      created.push(name);
      return {
        name,
        remove() {
          removed.push(name);
        },
      };
    }, capacity);
    const place = (zIndex) => buckets.bucketFor(zIndex);
    const nameOf = (bucket) => bucket.element.name;
    return { buckets, created, removed, place, nameOf };
  }

  it("fills a bucket before opening the next", () => {
    const { created, place, nameOf } = recordingBuckets(2);

    const placed = [1, 2, 3].map(() => nameOf(place("auto")));

    assert.deepEqual(placed, [
      "bucket-0@auto",
      "bucket-0@auto",
      "bucket-1@auto",
    ]);
    assert.deepEqual(created, ["bucket-0@auto", "bucket-1@auto"]);
  });

  it("keeps decorations of different z-index apart", () => {
    const { place } = recordingBuckets(64);

    const highlight = place("auto");
    const underline = place("2");

    assert.notEqual(highlight, underline);
    assert.equal(place("2"), underline);
  });

  it("opens new buckets once cleared", () => {
    const { buckets, created, place } = recordingBuckets(64);

    place("auto");
    buckets.clear();
    place("auto");

    assert.deepEqual(created, ["bucket-0@auto", "bucket-1@auto"]);
  });

  it("reuses the room a released decoration leaves", () => {
    const { buckets, created, removed, place } = recordingBuckets(2);

    for (let word = 0; word < 10; word++) {
      buckets.release(place("2"));
    }

    assert.deepEqual(created, ["bucket-0@2"]);
    assert.deepEqual(removed, []);
  });

  it("drops a filled bucket once its last decoration is released", () => {
    const { buckets, removed, place } = recordingBuckets(2);
    const first = place("auto");
    const second = place("auto");
    place("auto");

    buckets.release(first);
    assert.deepEqual(removed, []);
    buckets.release(second);

    assert.deepEqual(removed, ["bucket-0@auto"]);
  });

  it("ignores a release from before a clear", () => {
    const { buckets, created, removed, place } = recordingBuckets(2);
    const stale = place("auto");
    buckets.clear();
    const fresh = place("auto");

    buckets.release(stale);

    assert.equal(place("auto"), fresh);
    assert.deepEqual(created, ["bucket-0@auto", "bucket-1@auto"]);
    assert.deepEqual(removed, ["bucket-0@auto"]);
  });
});
