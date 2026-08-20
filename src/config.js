'use strict';

const path=require('path');

module.exports=function config(rootDir){
  return {
    PORT:Number(process.env.PORT||8787),
    HOST:process.env.HOST||'127.0.0.1',
    PROD:process.env.NODE_ENV==='production',
    COOKIE_SECURE:process.env.COOKIE_SECURE==='1',
    PUBLIC_DIR:path.join(rootDir,'public'),
    DATA_FILE:path.join(rootDir,'data','app-data.json'),
    PRIVATE_ROOT:path.join(rootDir,'private_uploads'),
    DB_FILE:process.env.DB_FILE||path.join(rootDir,'data','app.db')
  };
};
