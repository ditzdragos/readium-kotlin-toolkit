import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
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
