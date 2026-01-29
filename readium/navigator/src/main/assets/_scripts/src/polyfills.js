// Polyfills for older WebView runtimes (eg. Android 9).
// Keep this list minimal and focused on actual runtime failures.

if (!Array.prototype.flatMap) {
  Object.defineProperty(Array.prototype, "flatMap", {
    configurable: true,
    writable: true,
    value: function (callback, thisArg) {
      if (this == null) {
        throw new TypeError("Array.prototype.flatMap called on null or undefined");
      }
      if (typeof callback !== "function") {
        throw new TypeError("callback is not a function");
      }
      var result = [];
      var O = Object(this);
      var len = O.length >>> 0;
      for (var i = 0; i < len; i += 1) {
        if (i in O) {
          var mapped = callback.call(thisArg, O[i], i, O);
          if (Array.isArray(mapped)) {
            result.push.apply(result, mapped);
          } else {
            result.push(mapped);
          }
        }
      }
      return result;
    }
  });
}
