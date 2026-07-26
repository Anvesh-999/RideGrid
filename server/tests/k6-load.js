import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  stages: [
    { duration: '30s', target: 20 }, // Ramp up to 20 users
    { duration: '1m', target: 20 },  // Stay at 20 users
    { duration: '10s', target: 0 },  // Ramp down to 0 users
  ],
  thresholds: {
    http_req_duration: ['p(95)<500'], // 95% of requests should complete within 500ms
  },
};

const BASE_URL = __ENV.API_BASE_URL || 'http://localhost:5000/api';

export default function () {
  // 1. Check health
  const healthRes = http.get(`${BASE_URL.replace('/api', '')}/health`);
  check(healthRes, {
    'status is 200': (r) => r.status === 200,
  });

  // 2. Simulate Passenger Login (using a dummy account)
  const loginPayload = JSON.stringify({
    email: 'passenger@example.com',
    password: 'password123',
  });

  const params = {
    headers: {
      'Content-Type': 'application/json',
    },
  };

  const loginRes = http.post(`${BASE_URL}/auth/login`, loginPayload, params);
  
  if (loginRes.status === 200) {
    const token = loginRes.json('data.accessToken');
    
    const authParams = {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
    };

    // 3. Request Fare Estimate
    const estimatePayload = JSON.stringify({
      pickup: { address: 'Downtown Plaza', latitude: 12.9716, longitude: 77.5946 },
      destination: { address: 'Tech Park', latitude: 12.9279, longitude: 77.6271 },
      vehicleType: 'ECONOMY',
    });

    const estimateRes = http.post(`${BASE_URL}/rides/estimate`, estimatePayload, authParams);
    check(estimateRes, {
      'estimate status is 200': (r) => r.status === 200,
      'fare is estimated': (r) => r.json('data.fare') > 0,
    });
  }

  sleep(1);
}
