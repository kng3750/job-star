require('dotenv').config({path:'.env.local',quiet:true});
const {createApp}=require('./server/app');
const app=createApp();
if(require.main===module)app.listen(Number(process.env.PORT||3001),'127.0.0.1',()=>console.log('Job Star: http://localhost:'+(process.env.PORT||3001)));
module.exports=app;

