var casper = require('casper').create();
var utils = require('utils');
var fs = require('fs'); //fs here is a Phantomjs module, NOT the nodejs fs module!
var userEmail = casper.cli.get('userEmail'); 
var userPass  = casper.cli.get('userPass');
var EMS_URL = 
  'https://contact-vic.greens.org.au/agc/report/allpoly/h/_/142161/PCX!';
var userAgent = 
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.9; rv:31.0) Gecko/20100101 Firefox/31.0';
var totalNoPages;

casper.start();

casper.open(EMS_URL, {
  method: 'get',
  headers: {
    'user-agent':userAgent  
  }
});

casper.then(function () {
  this.echo('===> we are at webpage:');
  this.echo(this.getCurrentUrl());
  this.echo(this.getTitle());

  if (this.exists('form#user-login')) {
    this.echo('user login form exists. good. filling in the details and logging in.');
    this.fillSelectors('form#user-login', {
      'input#edit-name': userEmail,
      'input#edit-pass': userPass
    }, true);
  } else {
    this.echo('user login does NOT exist. bad.'); 
    this.exit();
  }
});

casper.then(function () {
  var links = [];
  var lastPage;
  var domSel = 'table.agc-t-report tr.agc-r-no-id';

  this.echo('===> we are at webpage:');
  //this.echo(this.getPageContent());
  this.echo(this.getCurrentUrl());
  this.echo(this.getTitle());

  if (this.exists('a[title="Go to last page"]')) {
    this.echo('last page link exists. good.'); 
    var lastHref = this.getElementAttribute('a[title="Go to last page"]', 'href');
    var pageIx = lastHref.indexOf('page=');
    var i;
    if (pageIx !== -1) {
      extraPages = parseInt(lastHref.slice(pageIx + 5, lastHref.length), 10);  
      this.echo('extraPages: ' + extraPages);

      for(i = 0; i <= extraPages; i++) {
        links.push(EMS_URL + '?page=' + i);
      }

      this.eachThen(links, function (response) {
        this.thenOpen(response.data, function (response) {
          this.echo('opened ' + response.url);	
	  //this.echo(response.body);
          var fileName = 'scrape_page_';
          var content = this.getElementsInfo(domSel);
          this.echo('records obtained: ' + content.length);
	  var link = response.url;
          fileName += link.slice(link.indexOf('page=') + 5, link.length) + '.txt';
          fs.write('scrapes/' + fileName, JSON.stringify(content), 'w');
	}); 
      });
    }   

  } else {
    this.echo('EDGE CASE: no last page link. assuming there is 1 page only...') 
    var content = this.getElementsInfo(domSel);
    fs.write('scrapes/scrape_0.txt', JSON.stringify(content), 'w');
  }
});

casper.run();
