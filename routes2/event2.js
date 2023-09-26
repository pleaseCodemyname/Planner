const express = require('express');
const { v4: uuidv4 } = require('uuid');
const jwt = require('jsonwebtoken');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const { DynamoDBClient, PutItemCommand, ScanCommand, GetItemCommand, UpdateItemCommand, DeleteItemCommand } = require('@aws-sdk/client-dynamodb');
const cookieParser = require('cookie-parser');
const path = require('path');
const cors = require('cors');
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage() });
const app = express();

const AWS_REGION = 'ap-northeast-2';

const s3Client = new S3Client({ region: AWS_REGION });
const dynamodbClient = new DynamoDBClient({ region: AWS_REGION });

// 쿠키 파서 및 다른 미들웨어 설정
app.use(cors());
app.use(express.json());
app.use(cookieParser());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// 디버깅: 토큰이 올바르게 수신되었는지 확인
function requireLogin(req, res, next) {
  const authorizationHeader = req.headers.authorization;

  if (!authorizationHeader) {
    return res.status(401).json({ detail: "인증되지 않았습니다 - 로그인이 필요합니다." });
  }

  // "Bearer" 스킴으로 시작하는 Authorization 헤더를 파싱하여 토큰 추출
  const token = authorizationHeader.replace('Bearer ', '');

  try {
    const decoded = jwt.verify(token, 'secret_key');
    req.user = decoded;
    next();
  } catch (error) {
    console.error("토큰 확인 오류:", error);
    return res.status(401).json({ detail: "인증되지 않았습니다 - 잘못된 토큰입니다." });
  }
}


// 목표 생성 upload.single("image") 미들웨어가 사용되고 있으므로, 사용자가 이미지를 업로드하려면 요청에 image라는 필드를 포함해야 합니다. req.file객체에 저장됨.
app.post("/goal/create", requireLogin, upload.single("image"), async (req, res) => { //image가 req.file에 저장됨
  const user = req.user;
  const { title, startDatetime, endDatetime, location, content } = req.body;

  try {
    let imageUrl = null; // 이미지 URL 초기값 = null

    if (req.file) { // 이미지가 업로드되었는지 확인
      const fileBuffer = req.file.buffer; //buffer에 저장됨, 이후 S3에 업로드할 때 사용됨
      const fileType = req.file.mimetype; //jpg, png등 다양한 형태의 img파일 지원
      const userId = user.user_id; //현재 사용자의 ID를 가져옴, 나중에 이미지 저장 경로, 식별자 등에 사용
      const key = `travel_photos/${uuidv4()}.jpg`;

      const params = { //S3에 업로드하기 이해 필요한 정보 설정.
        Bucket: 'seo-3169',
        Key: key,
        Body: fileBuffer,
        ContentType: fileType,
      };

      await s3Client.send(new PutObjectCommand(params)); //이미지를 S3에 저장

      imageUrl = `https://${params.Bucket}.s3.ap-northeast-2.amazonaws.com/${params.Key}`; //1. 클라이언트 업로드 이미지 2. S3저장 3. 이미지 URL = imageUrl 변수에 저장
    }

    // 나머지 데이터와 함께 DynamoDB에 저장
    const event_id = uuidv4();
    const eventType = 'Goal';
    const completeStatus = '미완료'; // 목표 생성 시 기본적으로 "미완료" 상태로 설정

    const eventParams = {
      TableName: 'Event',
      Item: { //실제 데이터 들어감
        'EventId': { S: event_id },
        'UserId': { S: user.user_id },
        'EventType': { S: eventType },
        'Title': { S: title },
        'StartDatetime': { S: startDatetime },
        'EndDatetime': { S: endDatetime },
        'Location': { S: location },
        'Content': { S: content },
        'CompletionStatus': { S: completeStatus }, // "CompletionStatus" 필드를 기반으로 "isCompleted" 필드 설정
      },
    };

    if (imageUrl) { //imageUrl = 이 존재하면 Item 필드에 PhotoURL 추가
      eventParams.Item['PhotoURL'] = { S: imageUrl };
    }

    await dynamodbClient.send(new PutItemCommand(eventParams));//eventParams값 받아서 DynamoDB에 넣는다.

    const goalData = { //goalData에 다 때려박음, 나중에 Client(Front)에서 데이터 사용할 때 유용함.
      event_id,
      user_id: user.user_id,
      eventType,
      title,
      startDatetime,
      endDatetime,
      location,
      content,
      photoUrl: imageUrl,
      isCompleted: completeStatus === '완료',
    };

    return res.status(200).json({
      event_id,
      message: "목표가 성공적으로 생성되었습니다.",
      goalData
    });
  } catch (error) {
    console.error('An error occurred while creating the goal with image: ', error);
    return res.status(500).json({ detail: "목표를 생성하는 중 오류가 발생했습니다." });
  }
});


// 목표 전체 조회
app.get("/goal/read", requireLogin, async (req, res) => {
  const user = req.user;
  const eventType = 'Goal';

  const params = {
    TableName: 'Event',
    FilterExpression: 'UserId = :userId AND EventType = :eventType',
    ExpressionAttributeValues: {
      ':userId': { S: user.user_id },
      ':eventType': { S: eventType },
    }
  };

  try {
    const command = new ScanCommand(params);
    const response = await dynamodbClient.send(command);

    const goals = response.Items.map(item => ({
      event_id: item.EventId.S,
      user_id: item.UserId.S,
      eventType: item.EventType.S,
      title: item.Title.S,
      startDatetime: item.StartDatetime.S,
      endDatetime: item.EndDatetime.S,
      location: item.Location.S,
      content: item.Content.S,
      photoUrl: item.PhotoURL ? item.PhotoURL.S : null,
      isCompleted: item.CompletionStatus ? item.CompletionStatus.S === '완료' : false, // "CompletionStatus" 필드를 기반으로 "isCompleted" 값을 설정
    }));

    return res.status(200).json(goals);
  } catch (error) {
    console.error('An error occurred while fetching goals: ', error);
    return res.status(500).json({ detail: "목표 목록을 불러오는 중 오류가 발생했습니다." });
  }
});


app.get("/goal/read/:event_id", requireLogin, async (req, res) => {
  const event_id = req.params.event_id;
  const user_id = req.params.user_id;

  const params = {
    TableName: 'Event',
    Key: {
      'EventId': { S: event_id }
    }
  };

  try {
    const command = new GetItemCommand(params);
    const response = await dynamodbClient.send(command);

    if (response.Item) {
      const item = response.Item;

      const goalData = {
        event_id: item.EventId.S,
        user_id: item.UserId.S,
        eventType: item.EventType.S,
        title: item.Title.S,
        startDatetime: item.StartDatetime.S,
        endDatetime: item.EndDatetime.S,
        location: item.Location.S,
        content: item.Content.S,
        photoUrl: item.PhotoURL ? item.PhotoURL.S : null,
        isCompleted: item.CompletionStatus ? item.CompletionStatus.S === '완료' : false,
      };

      return res.status(200).json(goalData);
    } else {
      return res.status(404).json({ detail: "목표를 찾을 수 없습니다." });
    }
  } catch (error) {
    console.error('An error occurred while fetching the goal: ', error);
    return res.status(500).json({ detail: "목표를 불러오는 중 오류가 발생했습니다." });
  }
});




// 목표 수정
app.put("/goal/update/:event_id", requireLogin, upload.single("image"), async (req, res) => {
  const user = req.user;
  const event_id = req.params.event_id;
  const { title, startDatetime, endDatetime, location, content } = req.body;

  try {
    // 목표를 먼저 가져옴
    const getParams = {
      TableName: 'Event',
      Key: {
        'EventId': { S: event_id },
        'UserId': { S: user.user_id },
      }
    };

    const getCommand = new GetItemCommand(getParams);
    const getResponse = await dynamodbClient.send(getCommand);

    if (!getResponse.Item) {
      return res.status(404).json({ detail: "목표를 찾을 수 없습니다." });
    }

    // 수정된 데이터로 업데이트
    const imageUrl = req.file ? `https://seo-3169.s3.ap-northeast-2.amazonaws.com/travel_photos/${uuidv4()}.jpg` : null;

    const updateParams = {
      TableName: 'Event',
      Key: {
        'EventId': { S: event_id },
        'UserId': { S: user.user_id },
      },
      UpdateExpression: 'SET Title = :title, StartDatetime = :startDatetime, EndDatetime = :endDatetime, Location = :location, Content = :content' + (imageUrl ? ', PhotoURL = :photoUrl' : ''),
      ExpressionAttributeValues: {
        ':title': { S: title },
        ':startDatetime': { S: startDatetime },
        ':endDatetime': { S: endDatetime },
        ':location': { S: location },
        ':content': { S: content },
        ...(imageUrl ? { ':photoUrl': { S: imageUrl } } : {}), // 이미지 URL이 있는 경우만 추가
      },
    };

    const updateCommand = new UpdateItemCommand(updateParams);
    await dynamodbClient.send(updateCommand);

    return res.status(200).json({ message: "목표가 성공적으로 업데이트되었습니다." });
  } catch (error) {
    console.error('An error occurred while processing the update request: ', error);
    return res.status(500).json({ detail: "목표를 업데이트하는 중 오류가 발생했습니다." });
  }
});


// 목표 삭제
app.delete("/goal/delete/:event_id", requireLogin, async (req, res) => {
  const user = req.user;
  const event_id = req.params.event_id;

  try {
    const params = {
      TableName: 'Event',
      Key: {
        'EventId': { S: event_id },
        'UserId': { S: user.user_id },
      },
    };

    const command = new DeleteItemCommand(params);
    await dynamodbClient.send(command);

    return res.status(200).json({ message: "목표가 성공적으로 삭제되었습니다." });
  } catch (error) {
    console.error('An error occurred while deleting the goal: ', error);
    return res.status(500).json({ detail: "목표를 삭제하는 중 오류가 발생했습니다." });
  }
});

// 사용자가 특정 날짜를 클릭할 때 해당 날짜의 목표를 가져오는 API
app.get("/goal/readByDate/:date", requireLogin, async (req, res) => {
  const user = req.user;
  const date = req.params.date; // 클라이언트에서 전달한 날짜

  // 날짜를 기준으로 DynamoDB에서 목표 목록을 조회합니다.
  const params = {
    TableName: 'Event',
    FilterExpression: 'UserId = :userId AND EventType = :eventType AND StartDatetime <= :date AND EndDatetime >= :date',
    ExpressionAttributeValues: {
      ':userId': { S: user.user_id },
      ':eventType': { S: 'Goal' },
      ':date': { S: date },
    }
  };

  try {
    const command = new ScanCommand(params);
    const response = await dynamodbClient.send(command);

    const goals = response.Items.map(item => ({
      event_id: item.EventId.S,
      user_id: item.UserId.S,
      eventType: item.EventType.S,
      title: item.Title.S,
      startDatetime: item.StartDatetime.S,
      endDatetime: item.EndDatetime.S,
      location: item.Location.S,
      content: item.Content.S,
      photoUrl: item.PhotoURL ? item.PhotoURL.S : null,
      isCompleted: item.Complete && item.Complete.BOOL ? true : false, // "Complete" 필드를 기반으로 "isCompleted" 값을 설정
    }));

    // 클라이언트에게 목표 목록을 반환합니다.
    return res.json(goals);
  } catch (error) {
    console.error('An error occurred:', error);
    return res.status(500).json({ detail: '내부 서버 오류' });
  }
});

// 사용자가 목표를 완료 또는 취소하는 API
app.get("/goal/complete/:event_id", requireLogin, async (req, res) => {
  const event_id = req.params.event_id;

  try {
    // 해당 목표의 현재 상태를 조회합니다.
    const getParams = {
      TableName: 'Event',
      Key: {
        'EventId': { S: event_id }
      },
      ProjectionExpression: 'CompletionStatus' // "CompletionStatus" 필드만 조회합니다.
    };

    const getCommand = new GetItemCommand(getParams);
    const getResponse = await dynamodbClient.send(getCommand);

    let currentStatus = "미완료"; // 현재 목표의 상태

    if (getResponse && getResponse.Item && getResponse.Item.CompletionStatus) {
      currentStatus = getResponse.Item.CompletionStatus.S;
    }

    // 상태를 토글합니다.
    const updatedStatus = currentStatus === "미완료" ? "완료" : "미완료";

    // 업데이트할 필드 목록 초기화
    const updateFields = ['CompletionStatus = :completionStatus']; // 항상 "CompletionStatus"를 업데이트하도록 함
    const expressionAttributeValues = {
      ':completionStatus': { S: updatedStatus },
    };

    const updateParams = {
      TableName: 'Event',
      Key: {
        'EventId': { S: event_id }
      },
      UpdateExpression: 'SET ' + updateFields.join(', '),
      ExpressionAttributeValues: expressionAttributeValues,
    };

    const updateCommand = new UpdateItemCommand(updateParams);
    const updateResponse = await dynamodbClient.send(updateCommand);

    if (updateResponse) {
      const message = updatedStatus === "완료" ? "목표가 성공적으로 완료되었습니다." : "목표 완료가 취소되었습니다.";
      return res.json({ message });
    } else {
      return res.status(404).json({ detail: "목표를 찾을 수 없음" });
    }
  } catch (error) {
    console.error('An error occurred:', error);
    return res.status(500).json({ detail: "내부 서버 오류" });
  }
});


// 9) 일정 생성
app.post("/event/create", requireLogin, async (req, res) => {
  const user = req.user;
  const { title, startDatetime, endDatetime, goal, location, content } = req.body;

  const event_id = uuidv4();
  const eventType = 'Event';

  const params = {
    TableName: 'Event',
    Item: {
      'EventId': { S: event_id },
      'UserId': { S: user.user_id },
      'EventType': { S: eventType },
      'Title': { S: title },
      'StartDatetime': { S: startDatetime },
      'EndDatetime': { S: endDatetime },
      'Goal': { S: goal },
      'Location': { S: location },
      'Content': { S: content }
    },
  };

  try {
    await dynamodbClient.send(new PutItemCommand(params));

    const eventData = {
      event_id,
      user_id: user.user_id,
      eventType,
      title,
      startDatetime,
      endDatetime,
      goal,
      location,
      content
    };

    return res.status(200).json({
      event_id,
      message: '일정이 성공적으로 생성되었습니다.',
      eventData
    });
  } catch (error) {
    console.error('An error occurred: ', error);
    return res.status(500).json({ detail: '내부 서버 오류' });
  }
});

// 10) 일정 전체 조회
app.get("/event/read", requireLogin, async (req, res) => {
  const user = req.user;
  const eventType = 'Event';

  const params = {
    TableName: 'Event',
    FilterExpression: 'UserId = :userId AND EventType = :eventType',
    ExpressionAttributeValues: {
      ':userId': { S: user.user_id },
      ':eventType': { S: eventType },
    }
  };

  try {
    const command = new ScanCommand(params); // AWS SDK 버전 3의 새로운 방식으로 명령(Command)을 생성합니다.
    const response = await dynamodbClient.send(command); // 명령을 실행하고 응답을 받습니다.

    const events = response.Items.map(item => ({
      event_id: item.EventId.S,
      user_id: item.UserId.S,
      eventType: item.EventType.S,
      title: item.Title.S,
      startDatetime: item.StartDatetime.S,
      endDatetime: item.EndDatetime.S,
      goal: item.Goal.S,
      location: item.Location.S,
      content: item.Content.S
    }));

    return res.status(200).json(events);
  } catch (error) {
    console.error('오류가 발생했습니다: ', error);
    return res.status(500).json({ detail: "내부 서버 오류" });
  }
});

// 11) 일정 하나만 조회
app.get("/event/read/:event_id", requireLogin, async (req, res) => {
  const user = req.user;
  const event_id = req.params.event_id;

  const params = {
    TableName: 'Event',
    Key: {
      'EventId': { S: event_id }
    }
  };

  try {
    const command = new GetItemCommand(params); // AWS SDK 버전 3의 새로운 방식으로 명령(Command)을 생성합니다.
    const response = await dynamodbClient.send(command); // 명령을 실행하고 응답을 받습니다.

    if (response.Item) {
      const eventData = {
        event_id: response.Item.EventId.S,
        user_id: response.Item.UserId.S,
        eventType: response.Item.EventType.S,
        title: response.Item.Title.S,
        startDatetime: response.Item.StartDatetime.S,
        endDatetime: response.Item.EndDatetime.S,
        goal: response.Item.Goal.S,
        location: response.Item.Location.S,
        content: response.Item.Content.S
      };
      return res.status(200).json(eventData);
    } else {
      return res.status(404).json({ detail: "일정을 찾을 수 없습니다." });
    }
  } catch (error) {
    console.error('오류가 발생했습니다: ', error);
    return res.status(500).json({ detail: '일정을 조회할 수 없습니다.' })
  }
});

// 12) 일정 수정
app.put("/event/update/:event_id", requireLogin, async (req, res) => {
  const event_id = req.params.event_id;
  const { title, startDatetime, endDatetime, goal, location, content } = req.body;

  // 업데이트할 필드 목록 초기화
  const updateFields = [];

  // 필드가 주어진 경우에만 해당 필드를 업데이트 목록에 추가
  if (title) {
    updateFields.push('#title = :title');
  }
  if (startDatetime) {
    updateFields.push('#startDatetime = :startDatetime');
  }
  if (endDatetime) {
    updateFields.push('#endDatetime = :endDatetime');
  }
  if (goal) {
    updateFields.push('#goal = :goal');
  }
  if (location) {
    updateFields.push('#location = :location');
  }
  if (content) {
    updateFields.push('#content = :content');
  }

  // 업데이트할 필드가 없으면 에러 메시지 반환
  if (updateFields.length === 0) {
    return res.status(400).json({ detail: "수정할 필드를 지정하세요." });
  }

  // UpdateExpression 생성
  const updateExpression = 'SET ' + updateFields.join(', ');

  const params = {
    TableName: 'Event',
    Key: {
      'EventId': { S: event_id }
    },
    // 업데이트 할 필드 및 값 정의
    UpdateExpression: updateExpression,
    // 필드 이름(Key 값)
    ExpressionAttributeNames: {
      '#title': 'Title',
      '#startDatetime': 'StartDatetime',
      '#endDatetime': 'EndDatetime',
      '#goal': 'Goal',
      '#location': 'Location',
      '#content': 'Content'
    },
    ExpressionAttributeValues: {
      ':title': { S: title },
      ':startDatetime': { S: startDatetime },
      ':endDatetime': { S: endDatetime },
      ':goal': { S: goal },
      ':location': { S: location },
      ':content': { S: content }
    }
  };

  try {
    const updateItemCommand = new UpdateItemCommand(params);
    await dynamodbClient.send(updateItemCommand);

    return res.status(200).json({ message: "일정이 성공적으로 업데이트되었습니다." });
  } catch (error) {
    console.error('An error occurred:', error);
    return res.status(500).json({ detail: "내부 서버 오류" });
  }
});


// 13) 일정 삭제
app.delete("/event/delete/:event_id", requireLogin, async (req, res) => {
  const event_id = req.params.event_id;

  const params = {
    TableName: 'Event',
    Key: {
      'EventId': { S: event_id }
    }
  };

  try {
    const command = new DeleteItemCommand(params); // AWS SDK 버전 3의 새로운 방식으로 명령(Command)을 생성합니다.
    const response = await dynamodbClient.send(command); // 명령을 실행하고 응답을 받습니다.

    if (response) {
      return res.json({ message: "일정이 성공적으로 삭제되었습니다." });
    } else {
      return res.status(404).json({ detail: "일정을 찾을 수 없음" });
    }
  } catch (error) {
    console.error('오류가 발생했습니다:', error);
    return res.status(500).json({ detail: "내부 서버 오류" });
  }
});

// 14) 특정 날짜의 이벤트 조회
app.get("/event/readByDate/:date", requireLogin, async (req, res) => {
  const user = req.user;
  const date = req.params.date; // 클라이언트에서 전달된 날짜

  // 날짜 범위를 설정합니다. 여기서는 날짜 범위를 해당 날짜의 00:00:00부터 23:59:59까지로 가정합니다.
  const params = {
    TableName: 'Event',
    FilterExpression: 'UserId = :userId AND EventType = :eventType AND StartDatetime <= :date AND EndDatetime >= :date',
    ExpressionAttributeValues: {
      ':userId': { S: user.user_id },
      ':eventType': { S: 'Event' },
      ':date': { S: date },
    }
  };

  try {
    const command = new ScanCommand(params);
    const response = await dynamodbClient.send(command);

    const events = response.Items.map(item => ({
      event_id: item.EventId.S,
      user_id: item.UserId.S,
      eventType: item.EventType.S,
      title: item.Title.S,
      startDatetime: item.StartDatetime.S,
      endDatetime: item.EndDatetime.S,
      goal: item.Goal.S,
      location: item.Location.S,
      content: item.Content.S
    }));

    return res.json(events);
  } catch (error) {
    console.error('오류가 발생했습니다: ', error);
    return res.status(500).json({ detail: "내부 서버 오류" });
  }
});


// 14) 할 일 생성
app.post("/todo/create", requireLogin, async (req, res) => {
  const user = req.user;
  const { title, goal, location, content, isCompleted } = req.body;

  const event_id = uuidv4();
  const eventType = 'Todo';

  const params = {
    TableName: 'Event',
    Item: {
      'EventId': { S: event_id },
      'UserId': { S: user.user_id },
      'EventType': { S: eventType },
      'Title': { S: title },
      'Goal': { S: goal },
      'Location': { S: location },
      'Content': { S: content },
      'IsCompleted': { BOOL: false } // 완료 상태를 기본값으로 추가
    },
  };

  try {
    const command = new PutItemCommand(params); // AWS SDK 버전 3의 새로운 방식으로 명령(Command)을 생성합니다.
    await dynamodbClient.send(command); // 명령을 실행합니다.

    const todoData = {
      event_id,
      user_id: user.user_id,
      eventType,
      title,
      goal,
      location,
      content,
      isCompleted
    };
    return res.status(200).json({
      event_id,
      message: '할 일이 성공적으로 생성되었습니다.',
      todoData
    });
  } catch (error) {
    console.error('오류가 발생했습니다:', error);
    return res.status(500).json({ detail: '내부 서버 오류' });
  }
});

// 15) 할 일 전체 조회
app.get("/todo/read", requireLogin, async (req, res) => {
  const user = req.user;
  const eventType = 'Todo';

  const params = {
    TableName: 'Event',
    FilterExpression: 'UserId = :userId and EventType = :eventType',
    ExpressionAttributeValues: {
      ':userId': { S: user.user_id },
      ':eventType': { S: eventType },
    }
  };

  try {
    const command = new ScanCommand(params); // AWS SDK 버전 3의 새로운 방식으로 명령(Command)을 생성합니다.
    const response = await dynamodbClient.send(command); // 명령을 실행하고 응답을 받습니다.

    const todos = response.Items.map(item => ({
      event_id: item.EventId.S,
      user_id: item.UserId.S,
      eventType: item.EventType.S,
      title: item.Title.S,
      goal: item.Goal.S,
      location: item.Location.S,
      content: item.Content.S,
      isCompleted: false // 완료 상태를 응답에 추가
    }));

    return res.json(todos);
  } catch (error) {
    console.error('오류가 발생했습니다:', error);
    return res.status(500).json({ detail: '내부 서버 오류' });
  }
});

// 16) 할 일 하나만 조회
app.get("/todo/read/:event_id", requireLogin, async (req, res) => {
  const user = req.user;
  const event_id = req.params.event_id;

  const params = {
    TableName: 'Event',
    Key: {
      'EventId': { S: event_id }
    }
  };

  try {
    const command = new GetItemCommand(params); // AWS SDK 버전 3의 새로운 방식으로 명령(Command)을 생성합니다.
    const response = await dynamodbClient.send(command); // 명령을 실행하고 응답을 받습니다.

    if (response.Item) {
      const todoData = {
        event_id: response.Item.EventId.S,
        user_id: response.Item.UserId.S,
        eventType: response.Item.EventType.S,
        title: response.Item.Title.S,
        goal: response.Item.Goal.S,
        location: response.Item.Location.S,
        content: response.Item.Content.S,
        isCompleted: item.IsCompleted.BOOL // 완료 상태를 응답에 추가
      };
      return res.json(todoData);
    } else {
      return res.status(404).json({ detail: "할 일을 찾을 수 없습니다." });
    }
  } catch (error) {
    console.error('오류가 발생했습니다:', error);
    return res.status(500).json({ detail: '할 일을 조회할 수 없습니다.' });
  }
});

// 할 일 수정 API (PUT /todo/update/:event_id):
app.put("/todo/update/:event_id", requireLogin, async (req, res) => {
  const event_id = req.params.event_id;
  const { title, goal, location, content, isComplete } = req.body; // 클라이언트에서 isComplete 값을 받음

  // 업데이트할 필드 목록 초기화
  const updateFields = [];

  // 필드가 주어진 경우에만 해당 필드를 업데이트 목록에 추가
  if (title) {
    updateFields.push('#title = :title');
  }
  if (goal) {
    updateFields.push('#goal = :goal');
  }
  if (location) {
    updateFields.push('#location = :location');
  }
  if (content) {
    updateFields.push('#content = :content');
  }
  if (isComplete !== undefined) { // isComplete 값이 주어진 경우에만 업데이트 목록에 추가
    updateFields.push('IsComplete = :isComplete');
  }

  // 업데이트할 필드가 없으면 에러 메시지 반환
  if (updateFields.length === 0) {
    return res.status(400).json({ detail: "수정할 필드를 지정하세요." });
  }

  // UpdateExpression 생성
  const updateExpression = 'SET ' + updateFields.join(', ');

  const params = {
    TableName: 'Event',
    Key: {
      'EventId': { S: event_id }
    },
    // 업데이트할 필드 및 값 정의
    UpdateExpression: updateExpression,
    // 필드 이름(Key 값)
    ExpressionAttributeNames: {
      '#title': 'Title',
      '#goal': 'Goal',
      '#location': 'Location',
      '#content': 'Content',
      '#isComplete': 'IsComplete'
    },
    ExpressionAttributeValues: {
      ':title': { S: title },
      ':goal': { S: goal },
      ':location': { S: location },
      ':content': { S: content },
      ':isComplete': { BOOL: isComplete !== undefined ? isComplete : false } // 클라이언트에서 받은 값 또는 기본값
    }
  };

  try {
    const command = new UpdateItemCommand(params);
    const response = await dynamodbClient.send(command);

    if (response) {
      return res.json({ message: "할 일이 성공적으로 업데이트되었습니다." });
    } else {
      return res.status(404).json({ detail: "할 일을 찾을 수 없음" });
    }
  } catch (error) {
    console.error('오류가 발생했습니다:', error);
    return res.status(500).json({ detail: "내부 서버 오류" });
  }
});


// 18) 할 일 삭제
app.delete("/todo/delete/:event_id", requireLogin, async (req, res) => {
  const user = req.user;
  const event_id = req.params.event_id;

  const params = {
    TableName: 'Event',
    Key: {
      'EventId': { S: event_id }
    }
  };

  try {
    const command = new DeleteItemCommand(params); // AWS SDK 버전 3의 새로운 방식으로 명령(Command)을 생성합니다.
    const response = await dynamodbClient.send(command); // 명령을 실행하고 응답을 받습니다.

    if (response) {
      return res.json({ message: "할 일이 성공적으로 삭제되었습니다." });
    } else {
      return res.status(404).json({ detail: "할 일을 찾을 수 없음" });
    }
  } catch (error) {
    console.error('오류가 발생했습니다:', error);
    return res.status(500).json({ detail: "내부 서버 오류" });
  }
});

app.put("/todo/complete/:event_id", requireLogin, async (req, res) => {
  const event_id = req.params.event_id;

  // "Complete" 필드를 true로 업데이트
  const updateFields = ['Complete = :complete'];
  const expressionAttributeValues = {
    ':complete': { BOOL: true },
  };

  const params = {
    TableName: 'Event',
    Key: {
      'EventId': { S: event_id }
    },
    UpdateExpression: 'SET ' + updateFields.join(', '),
    ExpressionAttributeValues: expressionAttributeValues,
  };

  try {
    const command = new UpdateItemCommand(params);
    const response = await dynamodbClient.send(command);

    if (response) {
      return res.json({ message: "할 일이 성공적으로 완료로 표시되었습니다." });
    } else {
      return res.status(404).json({ detail: "할 일을 찾을 수 없음" });
    }
  } catch (error) {
    console.error('An error occurred:', error);
    return res.status(500).json({ detail: "내부 서버 오류" });
  }
});
module.exports = app;