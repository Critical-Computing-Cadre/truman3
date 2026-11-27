/**
 * Run in the site after a page loads: tells the app what color the site is at its top and bottom
 * edges, so the strips behind the phone's own bars (the clock and battery above, the home buttons
 * below) can match it, as in other apps. The top is whatever is there, usually the site's header.
 * The bottom is the page's own background, since what scrolls past keeps changing. It looks again
 * every so often, because the site changes pages without loading, and a study can be light or dark.
 *
 * Colors come in many notations, so each is painted onto a one-pixel canvas and read back as red,
 * green and blue.
 */
export const REPORT_BARS = `
  (function () {
    if (window.trumanBars || !window.ReactNativeWebView) { return; }
    window.trumanBars = true;
    var canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1;
    var paint = canvas.getContext("2d", { willReadFrequently: true });
    function solid(element) {
      while (element) {
        paint.clearRect(0, 0, 1, 1);
        paint.fillStyle = getComputedStyle(element).backgroundColor;
        paint.fillRect(0, 0, 1, 1);
        var pixel = paint.getImageData(0, 0, 1, 1).data;
        if (pixel[3] > 127) { return [pixel[0], pixel[1], pixel[2]]; }
        element = element.parentElement;
      }
      return [255, 255, 255];
    }
    var last = "";
    function report() {
      var message = JSON.stringify({
        type: "bars",
        top: solid(document.elementFromPoint(window.innerWidth / 2, 1)),
        bottom: solid(document.body),
      });
      if (message !== last) {
        last = message;
        window.ReactNativeWebView.postMessage(message);
      }
    }
    report();
    setInterval(report, 700);
  })();
  true;
`;
