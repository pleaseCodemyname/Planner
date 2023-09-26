const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios')
const app = express();
const { DynamoDBClient, PutItemCommand, ScanCommand, GetItemCommand, UpdateItemCommand, DeleteItemCommand, BatchGetItemCommand } = require('@aws-sdk/client-dynamodb');
const AWS_REGION = 'ap-northeast-2';
const dynamodbClient = new DynamoDBClient({ region: AWS_REGION });

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: false }));


// 가져오려는 파일(event.js)을 가져오기
const eventApi = require('./event');

app.get('/goal/summary', async (req, res) => {
    try {
      const goals = await eventApi.getGoals(req.user);
      return res.status(200).json(goals);
    } catch (error) {
      console.error('An error occurred while fetching goals: ', error);
      return res.status(500).json({ detail: "An error occurred while loading the target list." });
    }
  });


app.post('/summarize', (req, res) => {
    // Extract the `text` from the request body
    const { text } = req.body;

    // Make an Axios POST request to the external API
    axios
        .post('http://43.201.211.135:8000/summarize', { text }) // Pass `text` in the request body
        .then(response => {
            console.log(`statusCode : ${response.status}`);
            console.log(response.data);
            res.send(response.data);
        })
        .catch(error => {
            console.error(error);
            res.status(500).send('An error occurred while making the request.');
        });
});

app.post('/plan_type', (req, res) => {
    const { text } = req.body;

    axios
        .post('http://43.201.211.135:8000/plan_type', {text })
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

app.post('/plan_crud', (req, res) => {
    const { text } = req.body;

    axios
        .post('http://43.201.211.135:8000/plan_crud', {text })
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


app.get('/goal/summary2', async (req, res) => {
    const eventType = 'Goal';
    const params = {
      TableName: 'Event',
      FilterExpression: 'EventType = :eventType',
      ExpressionAttributeValues: {
        ':eventType': { S: eventType },
      },
    };
    try {
      const command = new ScanCommand(params);
      const response = await dynamodbClient.send(command);
      // 업데이트된 값을 가져오기 위해 업데이트된 event_id 목록을 생성
      const updatedEventIds = response.Items.map(item => item.EventId.S);
      
      // 업데이트된 데이터를 가져오기 위해 BatchGetItem을 사용
      if (updatedEventIds.length === 0) {
        return res.status(200).json({ detail: "목표가 없습니다." });
      }
  
      const batchGetParams = {
        RequestItems: {
          'Event': {
            Keys: updatedEventIds.map(event_id => ({
              'EventId': { S: event_id }
            }))
          }
        }
      };
      const batchGetCommand = new BatchGetItemCommand(batchGetParams);
      const batchGetResponse = await dynamodbClient.send(batchGetCommand);
  
      // 필요한 필드만 선택하고 데이터를 변환하여 문자열로 조합
      const formattedGoals = batchGetResponse.Responses['Event'].map(item => ({
        title: item.Title.S,
        startDatetime: item.StartDatetime.S,
        endDatetime: item.EndDatetime.S,
        location: item.Location.S || '장소 정보 없음',
        content: item.Content.S || '내용 없음',
      }));
  
      const formattedGoalsString = formattedGoals.map(goal => (
        `목표: ${goal.title}\n일시: ${goal.startDatetime} ~ ${goal.endDatetime}\n장소: ${goal.location}\n내용: ${goal.content}`
      )).join('\n\n'); // 각 목표를 줄바꿈으로 구분하여 문자열로 조합
  
      return res.status(200).send(formattedGoalsString);
    } catch (error) {
      console.error('An error occurred while fetching goals: ', error);
      return res.status(500).json({ detail: "목표 목록을 불러오는 중 오류가 발생했습니다." });
    }
  });
  

  

module.exports = app;