//chat2.js
const axios = require('axios');
const express = require('express');
const bodyParser = require('body-parser');

const app = express();

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: false }));
// Python 서버의 엔드포인트 URL
const pythonServerUrl = 'http://43.201.211.135:8000';

// 보낼 데이터
const requestData = {
  user_id: '사용자 아이디',
  password: '사용자 패스워드',
};

axios
  .post(`${pythonServerUrl}/account/login`, requestData)
  .then((response) => {
    if (response.status === 200) {
      // 로그인 성공
      const token = response.data.token;

      // 토큰을 가지고 다른 요청을 보낼 수 있음
      axios.get(`${pythonServerUrl}/goal/read`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      })
      .then((goalsResponse) => {
        if (goalsResponse.status === 200) {
          const goals = goalsResponse.data;
          console.log('목표 데이터:', goals);
        } else {
          console.error('목표 데이터 가져오기 실패:', goalsResponse.status, goalsResponse.data);
        }
      })
      .catch((error) => {
        console.error('목표 데이터 가져오기 실패:', error);
      });
    } else {
      console.error('로그인 실패:', response.status, response.data);
    }
  })
  .catch((error) => {
    console.error('로그인 요청 실패:', error);
  });
  module.exports = app;