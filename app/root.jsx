// app/root.jsx
import {
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
} from "@remix-run/react";
export default function App() {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <script dangerouslySetInnerHTML={{ __html: `(function(){function s(t,d){try{navigator.sendBeacon('/api/client-log',JSON.stringify({t:t,d:String(d).slice(0,1500),u:location.pathname}))}catch(e){}}
window.addEventListener('error',function(e){s('error',(e.message||'')+' @'+(e.filename||'')+':'+(e.lineno||'')+' '+(e.error&&e.error.stack||''))});
window.addEventListener('unhandledrejection',function(e){s('rejection',e.reason&&(e.reason.stack||e.reason.message)||e.reason)});
var oe=console.error;console.error=function(){s('console.error',Array.prototype.join.call(arguments,' '));oe.apply(console,arguments)};
setTimeout(function(){var m=document.querySelector('.Polaris-Page')||document.body;s('state','body='+document.body.innerText.length+' polaris='+!!document.querySelector('.Polaris-Page')+' path='+location.pathname+location.search.slice(0,40))},5000)})();` }} />
        <Meta />
        <Links />
      </head>
      <body>
        <Outlet />
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}
