const express = require('express');
const morgan = require('morgan');
const path = require('path');
const bodyParser = require('body-parser');
const cookieParser = require('cookie-parser');
const cors = require('cors');

const app = express();

app.set('port', process.env.PORT || 8000);
app.use(morgan('dev'));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: false }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

const account = require('./routes/account2.js');
const event = require('./routes/event4.js');
app.use(cors());
app.use(account); // account.js 모듈 호출
app.use(event); // event.js 모듈 호출

app.listen(app.get('port'), () => {
  console.log('8000 Port : Server Started...');
});