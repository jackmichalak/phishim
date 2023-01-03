


# Phishim - let the user log in for you

Phishim is a phishing tool which reduces configuration time and bypasses 
most types of MFA by running a chrome tab on the server that the user unknowingly 
interacts with.

## What is different about Phishim?

Most phishing infrastructure works in one of two ways: either you create
static HTML pages (manually or by grabbing them during setup), or you proxy
traffic to the impersonated domain (possibly modifying contents on the fly).

Phishim works differently by proxying at the user interaction layer rather
than the traffic layer, reducing the amount of configuration required.
In particular, I no longer had to spend time removing troublesome JavaScript
from my landing pages like I had to with [GoPhish](https://getgophish.com/),
and I no longer had to spend time configuring rewrite rules like I had to
with [Evilginx2](https://github.com/kgretzky/evilginx2). The tradeoff is
that these other tools allow you to create much higher-fidelity impersonations
than this approach.

## Usage

First, [install node and npm](https://nodejs.org/en/download/package-manager/).

Then clone this repo and install dependencies:
```
$ git clone git@github.com:jackmichalak/phishim.git
$ cd phishim
$ npm install
```

You should now configure the variables at the top of `src/index.ts`. The first
string is where you are hosting your phish, and the others are how you interact
with the impersonated website. You may also want to add a `favicon.ico` file
at the root so that the correct favicon is displayed in the browser.

Once doing so you can start the server:
```
$ npm start
```

The phish interface by default runs on port 8080, and the admin interface
runs on port 3333. Once a user has logged in on the phish interface,
you can open up the admin interface to reconnect to their session and
browse as them.

## How it works

Phishim depends very heavily on [Puppeteer](https://pptr.dev/). Puppeteer is
a browser automation library which primarily focuses on testing automation,
but it has also been used extensively for web scraping. Phishim spins up
a Puppeteer browser for each user that visits the site. The server takes
screenshots of the web page and sends them down to the client over a web
socket connection for display, and the client sends up clicks and keyboard
presses to the server to be played on the page. Once the user successfully
logs in, they are redirected to the real website.

## Limitations

### Does not work for all types of MFA

While this approach has been tested for many of the most common MFA approaches
such as SMS, authenticator apps, in-app notifications, and the like, any
MFA approach which involves authenticating the URL in the browser will
succeed in protecting the user. For example, [WebAuthn](https://en.wikipedia.org/wiki/WebAuthn)
uses a different key pair per website which would prevent Phishim from
using the data received on the impersonated host.

### Some websites are able to detect something phishy is going on

In my testing multiple websites determined that my login attempts were
above-average risk and instituted higher-friction MFA techniques than
would otherwise be used, for example requiring the user enter a two-digit
number from the site into their mobile app, and one website outright
blocked the login altogether even though I had valid credentials. I
was able to work around some of these problems by modifying Phishim's
behavior.

### Requires the target to have a fast internet connection

The slower the internet connection between the server and the user, the
more noticeable it is that this is not the real site. Login pages are
often quite simple but delayed interactions can cause suspicion. As
high internet speeds proliferate this will be less of a concern.
