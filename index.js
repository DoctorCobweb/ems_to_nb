'use strict';

/*
 *
 * EMS to NB Sync: this script aims to attach logged contacts to ppl in NB using 
 * Pending Notes obtained from scraping the EMS site.
 * 
 *
 */

var fs    = require('fs'),
  exec    = require('child_process').exec,
  request = require('request'),
  csv     = require('csv'),
  _       = require('lodash'),
  chalk   = require('chalk');

var NB_FILE = process.cwd() + '/data/nationbuilder-people-export-439-2014-10-03.csv';
var userEmail;
var userPass;

//start
fs.readFile('.privateDetails.json', function (err, data) {
  if (err) throw err;
  var privateDetails = JSON.parse(data);
  userEmail = privateDetails.userEmail;
  userPass  = privateDetails.userPass;
  init();
});

function init() {
  fs.readFile(NB_FILE, {encoding:'utf-8'}, function (err, data) {
    if (err) throw err;
    csv.parse(data, function (error, nData) {
      if (error) throw error;  
      var nbIdIx       = nData[0].indexOf('nationbuilder_id');
      var civiIdIx     = nData[0].indexOf('civicrm_id');
      var phoneNumIx   = nData[0].indexOf('phone_number');
      var mobileNumIx  = nData[0].indexOf('mobile_number');
      var workNumIx    = nData[0].indexOf('work_phone_number');
      var fullNameIdx  = nData[0].indexOf('full_name');
      var firstNameIdx = nData[0].indexOf('first_name');
      var lastNameIdx  = nData[0].indexOf('last_name');

      var strippedData = nData.slice(1);
      var civiToNb = _.reduce(strippedData, function (result, val, ix) {
	var tObj = {};
	var nId        = val[nbIdIx].toString();
	var cId        = val[civiIdIx].toString();
	var phoneNum   = val[phoneNumIx].toString().trim().split(' ').join('');
	var mobileNum  = val[mobileNumIx].toString().trim().split(' ').join('');
	var workNum    = val[workNumIx].toString().trim().split(' ').join('');
	var fullName   = val[fullNameIdx].toString().trim();
	var firstName  = val[firstNameIdx].toString().trim();
	var lastName   = val[lastNameIdx].toString().trim();

	if (!nId) return result;

	tObj.nationbuilderId  = nId;
	tObj.civicrmId        = cId;
	tObj.phoneNumber      = phoneNum;
	tObj.mobileNumber     = mobileNum;
	tObj.workNumber       = workNum;
	tObj.fullName         = fullName;
	tObj.firstName        = firstName;
	tObj.lastName         = lastName;

        result.push(tObj);	

	return result;
      }, []);
      theScrape(civiToNb);
    });  
  });
}

function theScrape(civiToNb) {
  var casperCmd = 'casperjs --engine=slimerjs' 
	          + ' --userEmail=' + userEmail 
	          + ' --userPass=' + userPass
		  + ' emsScraper.js';
  console.log(chalk.bgMagenta('===> calling: casperjs --engine=slimerjs emsScraper.js'));
  exec(casperCmd, {}, function (err, stdout, stderr) {
    var combinedScrape = [];
    if (err) throw err; 
    console.log('in callback');
    console.log(stdout);

    //TODO: no assumption that scrape went all good.
    //want to read all .txt files in and separate each with a ',' and push to a combined
    fs.readdir(process.cwd() + '/scrapes', function (err, files) {
      if (err) throw err; 
      //console.log('===> individual scraped files in /scrapes:');
      //console.dir(files);
      _.forEach(files, function (file) {
        var data = fs.readFileSync('scrapes/' + file, {encoding:'utf-8'});
	var pData = JSON.parse(data);
	combinedScrape.push(pData);
      });
      var tScrapes = _.flatten(combinedScrape);
      console.log('tScrapes.length: ' + tScrapes.length);
      var sFile = 'tastyScrapes.txt';
      fs.writeFile(sFile, JSON.stringify(tScrapes), function (err) {
        if (err) throw err; 
	console.log('successfully saved tastyScrapes.txt');
        theExtraction(civiToNb);	
      });
    });
  }); 
}

function theExtraction(civiToNb) {
  fs.readFile('tastyScrapes.txt', {encoding:'utf-8'}, function (err, data) {
    var allDetails = [],
        pData = JSON.parse(data), 
        fileName = 'EMS_extractedDetails.csv',
	unmatchedCiviToNbPpl = 0,
        csvHeader,
        csvContent;

    if (err) throw err; 

    csvHeader = 
        'direct_match'         + '|'
      + 'phone_and_name_match' + '|'
      + 'nationbuilder_id_NB'  + '|'
      + 'emsId_NB'             + '|' 
      + 'phoneNum_NB'          + '|' 
      + 'mobileNum_NB'         + '|' 
      + 'workNum_NB'           + '|'
      + 'firstName_NB'         + '|'
      + 'lastName_NB'          + '|'
      + 'firstName_EMS'        + '|'
      + 'lastName_EMS'         + '|'
      + 'phone_EMS'            + '|' 
      + 'status_EMS'           + '|'
      + 'pendingNote_EMS' + '\n';

    csvContent = csvHeader;

    _.forEach(pData, function (item) {
      var html           = item.html,
          emsIdIdx       = html.indexOf('contact_id='),
          nameIdx        = html.indexOf('agc-f-contact'),
          phoneIdx       = html.indexOf('agc-f-phone'),
          statusIdx      = html.indexOf('agc-f-allocation_status'),
          pendingNoteIdx = html.indexOf('agc-f-pending_note'),
          options        = {},
          personDetails,
	  directMatch,
	  phoneAndNameMatch,
          NBId,
          NBPhoneNum,
          NBMobNum,
          NBWorkNum,
	  NBFirstName,
	  NBLastName,
          civiMatchIdx,
	  matchUsingPhone,
	  reducedPhones,
	  matchIdx,
	  matchedPersonNB; 

      if (emsIdIdx       === -1 || 
	  nameIdx        === -1 || 
	  phoneIdx       === -1 || 
	  statusIdx      === -1 || 
	  pendingNoteIdx === -1) 
      {
        throw Error('could not find an index properly. check which one.'); 
      } else {
        options = {
          emsIdIdx:       emsIdIdx,	
          nameIdx:        nameIdx,	
          phoneIdx:       phoneIdx,	
          statusIdx:      statusIdx,	
          pendingNoteIdx: pendingNoteIdx 
	}; 

        pData = extractPersonDetails(html, options); 
	allDetails.push(pData);
	//console.dir(pData);

	// important: using NB export file, try to find the person's civicrm_id.
	// if found, they will have a nationbuilder_id. good.
	// if not found, we need to do further processing using phone numbers to find
	// a potential match.
	// if that fails, then stop trying to match the person & log it for follow up. 
	civiMatchIdx = _.findIndex(civiToNb, function (item) {
          return item.civicrmId === pData.emsId;	
	});

	if (civiMatchIdx === -1) {
	  unmatchedCiviToNbPpl++;
	  directMatch = 'no';
	  phoneAndNameMatch = 'no';
	  //TODO: alter if we find a phone match
	  NBId = NBPhoneNum = NBMobNum = NBWorkNum = NBFirstName = NBLastName = 'fail';
	  matchUsingPhone = tryPhoneNumbers(civiToNb, pData);
          //console.log(matchUsingPhone);

	  reducedPhones = _.reduce(matchUsingPhone, function (result, item) {
            //console.log('item');
            //console.log(item);

	    if (item.phoneIdx  !== -1) {
	      result.push(item.phoneIdx);
	      return result;
	    }
	    if (item.mobileIdx !== -1) {
              result.push(item.mobileIdx);
	      return result;
	    }
	    if (item.workIdx   !== -1) {
	      result.push(item.workIdx);
	      return result;
	    }
	    result.push(-1);
	    return result;
	  }, []);
          //console.log('reducedPhones');
          //console.log(reducedPhones);
	  matchIdx = _.remove(reducedPhones, function (num) {return num !== -1;});
          //console.log('matchIdx');
          //console.log(matchIdx);
	  if (matchIdx.length !== 0) {
            //if we get here then there has has a phone number match
	    //need to further siphon out ppl based on whether their first, last names
	    //match up. e.g. sometimes for a landline there will be many ppl in ems
	    //with that number.
	    matchedPersonNB = civiToNb[matchIdx[0]]; //default pick first element 
	     
            if (matchedPersonNB.firstName.toLowerCase() === pData.name[1].toLowerCase()
	     && matchedPersonNB.lastName.toLowerCase()  === pData.name[0].toLowerCase())
	    {
              //console.log('FIRST and LAST NAMES MATCH UP. SWEET');
	      //console.log('civiToNb (data from NB export) MATCH:');
              //console.log(matchedPersonNB);
	      //console.log('pData (data from EMS scrape) MATCH:');
	      //console.log(pData);
	      //console.log('=============================');

	      NBId        = matchedPersonNB.nationbuilderId;
	      NBPhoneNum  = matchedPersonNB.phoneNumber;
	      NBMobNum    = matchedPersonNB.mobileNumber;
	      NBWorkNum   = matchedPersonNB.workNumber;
	      NBFirstName = matchedPersonNB.firstName;
	      NBLastName  = matchedPersonNB.lastName;
	      unmatchedCiviToNbPpl--;
	      phoneAndNameMatch = 'yes';
	    }
	  }

	} else {
	  directMatch = 'yes';
	  phoneAndNameMatch  = 'no';
          NBId        = civiToNb[civiMatchIdx].nationbuilderId;
          NBPhoneNum  = civiToNb[civiMatchIdx].phoneNumber;
          NBMobNum    = civiToNb[civiMatchIdx].mobileNumber;
          NBWorkNum   = civiToNb[civiMatchIdx].workNumber;
          NBFirstName = civiToNb[civiMatchIdx].firstName;
          NBLastName  = civiToNb[civiMatchIdx].lastName;;
	}
	
	csvContent  = 
	    csvContent
	  + directMatch       + '|'
	  + phoneAndNameMatch + '|'
	  + NBId              + '|'
	  + pData.emsId       + '|' 
          + NBPhoneNum        + '|'
          + NBMobNum          + '|'
          + NBWorkNum         + '|'
          + NBFirstName       + '|'
          + NBLastName        + '|'
	  + pData.name[1]     + '|' 
	  + pData.name[0]     + '|' 
	  + pData.phone       + '|'
	  + pData.status      + '|'
          + pData.pendingNote 
	  + '\n';
      }
    });

    //console.log(csvContent);
    console.log(chalk.bgRed('TOTAL UNMATCHED PPL (not direct and not phone): ' 
			    + unmatchedCiviToNbPpl));

    fs.writeFile(fileName, csvContent, function (err) {
      if (err) throw err;	
      console.log('successfully saved all extracted person details');
      console.log(allDetails.length);
    });
  });
}

function tryPhoneNumbers(civiToNb, pData) {
  var cPhone = pData.phone.split(',');

  if (cPhone[0] === "") {
    return [{
      phoneIdx: -1,
      mobileIdx: -1,
      workIdx: -1 
    }]; 
  }

  var matchAttempts = _.reduce(cPhone, function (result, phone, ix) {
    result.push({
      phoneIdx: _.findIndex(civiToNb, function (person) {
        return person.phoneNumber === pData.phone;}),
      mobileIdx:_.findIndex(civiToNb, function (person) {
        return person.mobileNumber === pData.phone;}),
      workIdx: _.findIndex(civiToNb, function (person) {
        return person.workNumber === pData.phone;})
    });
    return result;
  }, []);

  return matchAttempts;
}

function extractPersonDetails (html, opt) {
  function getEmsId () {
    var key = 'contact_id=';
    var idx = opt.emsIdIdx;
    var nextMark = html.indexOf('"', idx);
    return html.slice(idx + key.length, nextMark);
  }
  function getName() {
    var key = 'agc-f-contact">';
    var idx = opt.nameIdx;
    var nextMark = html.indexOf('<', idx);
    var nameString = html.slice(idx + key.length, nextMark);
    var nArray = nameString.split(',');
    nArray[0] = nArray[0] ? nArray[0].trim() : 'no_value';
    nArray[1] = nArray[1] ? nArray[1].trim() : 'no_value';
    return nArray;
  }
  function getPhone() {
    var key = 'agc-f-phone">';
    var idx = opt.phoneIdx;
    var nextMark = html.indexOf('<', idx);
    var phones = html.slice(idx + key.length, nextMark).trim();
    return phones.split(' ').join('');
  }
  function getStatus () {
    var key = 'agc-f-allocation_status">';
    var idx = opt.statusIdx;
    var nextMark = html.indexOf('<', idx);
    return html.slice(idx + key.length, nextMark);
  }
  function getPendingNote () {
    var key = 'agc-f-pending_note">';
    var idx = opt.pendingNoteIdx;
    var nextMark = html.indexOf('<', idx);
    return html.slice(idx + key.length, nextMark);
  }
  return {
    emsId:       getEmsId(),
    name:        getName(),
    phone:       getPhone(),
    status:      getStatus(), 
    pendingNote: getPendingNote() 
  };
}
