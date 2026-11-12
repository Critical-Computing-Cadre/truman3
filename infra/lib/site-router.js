// Runs at CloudFront on each request for the public site (ADR 75), as a CloudFront Function.
//
// The site is static pages with clean addresses: /about is the file about.html, and / is
// index.html. S3 doesn't know that, so this names the file. It also sends www to the bare domain,
// so every page has one address.

// biome-ignore lint/correctness/noUnusedVariables: CloudFront calls this.
function handler(event) {
  var request = event.request;
  var uri = request.uri;
  var headers = request.headers || {};
  var host = headers.host ? headers.host.value : "";

  if (host.startsWith("www.")) {
    return {
      statusCode: 301,
      statusDescription: "Moved Permanently",
      headers: { location: { value: `https://${host.slice(4)}${uri}` } },
    };
  }
  if (uri.endsWith("/")) {
    request.uri = `${uri}index.html`;
  } else if (uri.slice(uri.lastIndexOf("/") + 1).indexOf(".") === -1) {
    request.uri = `${uri}.html`;
  }
  return request;
}
