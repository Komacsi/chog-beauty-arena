import {resolve,sep} from 'node:path';
import {deploymentReviewServer} from '../lib/deployment-review-server.mjs';
const root=resolve(import.meta.dirname,'..'),directory=resolve(process.argv[2]??'');
if(!process.argv[2]||!directory.startsWith(resolve(root,'artifacts')+sep))throw Error('Pass the prepared directory inside artifacts/');
const port=Number(process.env.ARENA_DEPLOYMENT_PORT||3110);
if(!Number.isInteger(port)||port<1024||port>65535)throw Error('Invalid local deployment review port');
const server=await deploymentReviewServer(directory,port);console.log('Local deployment review: '+server.url+' (open in your browser with Rabby)');
for(const event of ['SIGINT','SIGTERM'])process.on(event,async()=>{await server.close();process.exit(0);});
