const fs = require('fs');
let content = fs.readFileSync('index.html', 'utf8');

const additionalStyles = `
  body {
    background-image: url('/themes/-1-/background_spring.gif') !important;
    background-repeat: repeat !important;
    background-color: #EBB66C !important;
  }
  body > table {
    max-width: 1000px !important;
    margin: 0 auto !important;
    background-color: #ffffff !important;
    box-shadow: 0 0 15px rgba(0,0,0,0.2);
  }
  /* Modern Top Buttons */
  .modern-top-btn {
    display: inline-block;
    padding: 6px 15px;
    margin: 2px;
    background-color: #ECE164;
    color: #000 !important;
    text-decoration: none;
    font-size: 14px;
    font-weight: bold;
    border: 1px solid #D1CEAA;
    border-radius: 4px;
  }
  .modern-top-btn:hover {
    background-color: #D8D6BE;
  }
  /* Modern Nav Buttons (Left menu) */
  .modern-nav-btn {
    display: block;
    width: 132px;
    padding: 8px 10px;
    margin-bottom: 5px;
    background-color: #FAF8DD;
    color: #0000ee !important;
    text-decoration: none;
    font-size: 15px;
    font-weight: bold;
    border: 1px solid #D1CEAA;
    border-radius: 4px;
    text-align: center;
  }
  .modern-nav-btn:hover {
    background-color: #D3D2C4;
  }
  /* Fix lists */
  ul {
    list-style-image: none !important;
    list-style-type: disc !important;
  }
  /* Ad containers */
  .ad-left, .ad-right {
    position: fixed;
    top: 150px;
    width: 160px;
    height: 600px;
    background-color: rgba(255, 255, 255, 0.9);
    border: 2px dashed #ccc;
    text-align: center;
    padding: 10px;
    color: #666;
    font-weight: bold;
    z-index: 1;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .ad-left { left: calc(50% - 680px); }
  .ad-right { right: calc(50% - 680px); }
  @media (max-width: 1400px) {
    .ad-left, .ad-right { display: none !important; }
  }
`;

console.log("CSS ready");
