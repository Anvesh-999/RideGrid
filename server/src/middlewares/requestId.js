import { v4 as uuidv4 } from 'uuid';

const requestId = (req, res, next) => {
  const reqId = req.headers['x-request-id'] || uuidv4();
  req.id = reqId; // Set on request object for logging
  res.setHeader('x-request-id', reqId); // Echo in response header
  next();
};

export default requestId;
