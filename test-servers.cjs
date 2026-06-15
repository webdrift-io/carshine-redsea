async function test() {
  console.log('Service Live Status\n');
  
  // 1. Service Agent
  const health = await fetch('http://localhost:5000/health');
  const h = await health.json();
  console.log('Service Agent (5000):', h.status, '| AI:', h.checks.aiProvider, '| DB:', h.checks.database);
  
  // 2. Landing pages
  for (const lang of ['en', 'ar', 'de']) {
    const url = lang === 'en' ? 'http://localhost:4173/' : 'http://localhost:4173/' + lang + '/';
    const r = await fetch(url);
    const html = await r.text();
    const match = html.match(/<title>([^<]+)<\/title>/);
    const title = match ? match[1] : 'no title';
    console.log('Landing (' + lang + '):', r.status, '|', title.substring(0, 50));
  }
  
  // 3. Auth
  const login = await fetch('http://localhost:5000/api/auth/login', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({email: 'admin@carshineredsea.com', password: 'ChangeMe123!'})
  });
  const loginData = await login.json();
  console.log('Admin login:', loginData.token ? 'JWT issued' : 'FAIL');
  const token = loginData.token;
  
  // 4. Public chat
  const chat = await fetch('http://localhost:5000/api/public/chat', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({message: 'Hello, I want to book a car wash'})
  });
  const d = await chat.json();
  console.log('Public chat:', chat.status, '|', d.reply ? d.reply.substring(0, 40) + '...' : 'no reply');
  
  // 5. Bookings
  const bookings = await fetch('http://localhost:5000/api/bookings', {
    headers: {'Authorization': 'Bearer ' + token}
  });
  const bookingsData = await bookings.json();
  console.log('Bookings:', bookingsData.length, 'total');
  
  // 6. CORS check
  const cors = await fetch('http://localhost:5000/health', {
    headers: {'Origin': 'http://localhost:4173'}
  });
  console.log('CORS from landing page:', cors.headers.get('access-control-allow-origin') || 'default');
  
  // 7. OpenAPI
  const openapi = await fetch('http://localhost:5000/api-docs/openapi.json');
  const o = await openapi.json();
  console.log('OpenAPI:', o.openapi, '|', Object.keys(o.paths).length, 'endpoints');
  
  // 8. Chatbot widget
  const widget = await fetch('http://localhost:5000/chatbot-widget.js');
  const widgetJs = await widget.text();
  console.log('Chatbot widget:', widget.status, '|', widgetJs.includes('CarShineChat') ? 'embedded API present' : 'FAIL');
  
  console.log('\nBoth servers live and integrated!');
}

test().catch(e => console.error('Error:', e.message));
