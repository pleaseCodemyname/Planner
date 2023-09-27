//chat.js
const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios')
const app = express();
const { DynamoDBClient, PutItemCommand, ScanCommand, GetItemCommand, UpdateItemCommand, DeleteItemCommand, BatchGetItemCommand } = require('@aws-sdk/client-dynamodb');
const AWS_REGION = 'ap-northeast-2';
const dynamodbClient = new DynamoDBClient({ region: AWS_REGION });

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: false }));

//1st API
app.post('/plan_type', (req, res) => {
    const { text } = req.body;

    axios
        .post('http://43.201.211.135:8000/plan_type', { text })
        .then(response => {
            console.log(`statusCode : ${response.status}`);
            console.log(response.data);
            res.send(response.data);;
        })
        .catch(error => {
            console.error(error);
            res.status(500).send('An error occurred while making the request.');
        });
})

//2nd API
app.post('/plan_crud', (req, res) => {
    const { text } = req.body;

    axios
        .post('http://43.201.211.135:8000/plan_crud', { text })
        .then(response => {
            console.log(`statusCode : ${response.status}`);
            console.log(response.data);
            res.send(response.data);;
        })
        .catch(error => {
            console.error(error);
            res.status(500).send('An error occurred while making the request.');
        });
})

// 파라미터 추출 함수
async function extractParameters(inputText) {
  try {
    const response = await axios.post('http://43.201.211.135:8000/extract_parameters', {
      input_text: inputText
    }, {
      headers: {
        'Content-Type': 'application/json'
      }
    });
    const responseData = response.data;
    // console.log(`responseData : ${JSON.stringify(response)}`)
    console.log(`responseData : ${JSON.stringify(response.data)}`)

    return responseData;
  } catch (error) {
    console.error('Error:', error);
    return {}; // 오류 처리를 위해 빈 객체 반환
  }
}
// 3rd API
app.post('/extract_parameters', async (req, res) => {
  const { input_text } = req.body; //사용자의 입력한 값을 그대로 가져옴
  const extractedParameters = await extractParameters(input_text); //사용자의 입력값을 python의 extract_parameter의 기능을 담은 extractParameters의 함수를 사용함(Json Type으로 변환)
  console.log(extractedParameters)
  // 추출된 파라미터를 응답 형식으로 변환하여 반환 (jsontype으로 한 번 더 변환하는게 아니야???)
  res.json(extractedParameters); // 이미 JSON 형식으로 된 데이터를 그대로 응답으로 보냅니다.
});



module.exports = app;