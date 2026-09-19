require('dotenv').config({path:'.env.local',quiet:true});
const required=['APP_ORIGIN','AUTH_SERVER_ORIGIN','AUTH_CLIENT_ID','AUTH_CLIENT_SECRET','AUTH_REDIRECT_URI','GEMINI_API_KEY'];
const missing=required.filter(name=>!process.env[name]);
if(missing.length){console.error('Missing settings: '+missing.join(', '));process.exitCode=1;}
else{try{require('../server/auth').readConfig();console.log('Configuration format OK. Live connectivity is not checked.');}catch{console.error('Invalid origin, callback URL, or client secret.');process.exitCode=1;}}
