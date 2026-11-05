/**
 * Export Manager - Handle exporting stats to PDF/CSV
 */

export function exportToCSV(userData) {
  if (!userData) return;

  const profile = userData.profile || {
    username: userData.username || 'user',
    realName: userData.realName || 'N/A',
    ranking: userData.ranking || 'N/A'
  };
  const stats = userData.stats || {
    streak: userData.streak || 0,
    total: userData.totalSolved || userData.total || 0,
    easy: userData.easySolved || userData.easy || 0,
    medium: userData.mediumSolved || userData.medium || 0,
    hard: userData.hardSolved || userData.hard || 0
  };
  const submissionCalendar = userData.submissionCalendar || {};
  
  // Create CSV content
  let csvContent = "LeetCode Statistics Report\n\n";
  csvContent += `Username,${profile.username}\n`;
  csvContent += `Real Name,${profile.realName || 'N/A'}\n`;
  csvContent += `Current Streak,${stats.streak || 0} days\n`;
  csvContent += `Total Problems,${stats.total || 0}\n`;
  csvContent += `Easy Problems,${stats.easy || 0}\n`;
  csvContent += `Medium Problems,${stats.medium || 0}\n`;
  csvContent += `Hard Problems,${stats.hard || 0}\n`;
  csvContent += `Global Ranking,${profile.ranking || 'N/A'}\n\n`;
  
  // Add submission history
  csvContent += "Date,Submissions\n";
  
  if (submissionCalendar) {
    const entries = Object.entries(submissionCalendar)
      .filter(([_, count]) => parseInt(count) > 0)
      .sort(([a], [b]) => parseInt(b) - parseInt(a))
      .slice(0, 30); // Last 30 days with activity
    
    entries.forEach(([timestamp, count]) => {
      const date = new Date(parseInt(timestamp) * 1000);
      const dateStr = date.toLocaleDateString('en-US', { 
        year: 'numeric', 
        month: '2-digit', 
        day: '2-digit' 
      });
      csvContent += `${dateStr},${count}\n`;
    });
  }
  
  // Create blob and download
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);
  
  link.setAttribute('href', url);
  link.setAttribute('download', `leetcode_stats_${profile.username}_${Date.now()}.csv`);
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

export function exportToPDF(userData) {
  if (!userData) return;

  const profile = userData.profile || {
    username: userData.username || 'user',
    realName: userData.realName || 'N/A',
    ranking: userData.ranking || 'N/A'
  };
  const stats = userData.stats || {
    streak: userData.streak || 0,
    total: userData.totalSolved || userData.total || 0,
    easy: userData.easySolved || userData.easy || 0,
    medium: userData.mediumSolved || userData.medium || 0,
    hard: userData.hardSolved || userData.hard || 0
  };
  
  // Create a simple HTML structure for PDF
  const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>LeetCode Stats - ${profile.username}</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      max-width: 800px;
      margin: 40px auto;
      padding: 20px;
      color: #333;
    }
    .header {
      text-align: center;
      margin-bottom: 40px;
      border-bottom: 3px solid #FF6B35;
      padding-bottom: 20px;
    }
    .header h1 {
      color: #FF6B35;
      margin: 0;
      font-size: 32px;
    }
    .header p {
      color: #666;
      margin: 10px 0 0 0;
    }
    .stats-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 20px;
      margin: 30px 0;
    }
    .stat-card {
      background: #f8f9fa;
      padding: 20px;
      border-radius: 12px;
      border-left: 4px solid #FF6B35;
    }
    .stat-card h3 {
      margin: 0 0 10px 0;
      color: #666;
      font-size: 14px;
      text-transform: uppercase;
      letter-spacing: 1px;
    }
    .stat-card .value {
      font-size: 32px;
      font-weight: bold;
      color: #FF6B35;
    }
    .difficulty-section {
      margin: 30px 0;
    }
    .difficulty-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 15px;
      margin-top: 15px;
    }
    .difficulty-card {
      padding: 15px;
      border-radius: 8px;
      text-align: center;
    }
    .difficulty-card.easy {
      background: #d4edda;
      border: 2px solid #28a745;
    }
    .difficulty-card.medium {
      background: #fff3cd;
      border: 2px solid #ffc107;
    }
    .difficulty-card.hard {
      background: #f8d7da;
      border: 2px solid #dc3545;
    }
    .difficulty-card .value {
      font-size: 28px;
      font-weight: bold;
      margin: 5px 0;
    }
    .difficulty-card.easy .value { color: #28a745; }
    .difficulty-card.medium .value { color: #ffc107; }
    .difficulty-card.hard .value { color: #dc3545; }
    .footer {
      margin-top: 40px;
      text-align: center;
      color: #999;
      font-size: 12px;
      border-top: 1px solid #ddd;
      padding-top: 20px;
    }
    @media print {
      body { margin: 0; }
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>🚀 LeetCode Statistics</h1>
    <p><strong>${profile.username}</strong>${profile.realName ? ` • ${profile.realName}` : ''}</p>
  </div>

  <div class="stats-grid">
    <div class="stat-card">
      <h3>🔥 Current Streak</h3>
      <div class="value">${stats.streak || 0}</div>
      <p style="margin: 5px 0 0 0; color: #666;">days</p>
    </div>
    <div class="stat-card">
      <h3>📊 Total Problems</h3>
      <div class="value">${stats.total || 0}</div>
      <p style="margin: 5px 0 0 0; color: #666;">solved</p>
    </div>
  </div>

  <div class="difficulty-section">
    <h2 style="color: #333; margin-bottom: 15px;">Problem Breakdown</h2>
    <div class="difficulty-grid">
      <div class="difficulty-card easy">
        <h4 style="margin: 0; color: #28a745;">Easy</h4>
        <div class="value">${stats.easy || 0}</div>
      </div>
      <div class="difficulty-card medium">
        <h4 style="margin: 0; color: #ffc107;">Medium</h4>
        <div class="value">${stats.medium || 0}</div>
      </div>
      <div class="difficulty-card hard">
        <h4 style="margin: 0; color: #dc3545;">Hard</h4>
        <div class="value">${stats.hard || 0}</div>
      </div>
    </div>
  </div>

  ${profile.ranking ? `
  <div class="stat-card" style="margin: 30px 0;">
    <h3>🏆 Global Ranking</h3>
    <div class="value">#${profile.ranking.toLocaleString()}</div>
  </div>
  ` : ''}

  <div class="footer">
    <p>Generated by LeetStreak on ${new Date().toLocaleDateString('en-US', { 
      year: 'numeric', 
      month: 'long', 
      day: 'numeric' 
    })}</p>
    <p>Profile: https://leetcode.com/${profile.username}</p>
  </div>
</body>
</html>
  `;

  // Create a new window and print
  const printWindow = window.open('', '_blank');
  printWindow.document.write(htmlContent);
  printWindow.document.close();
  
  // Wait for content to load then print
  printWindow.onload = () => {
    printWindow.focus();
    setTimeout(() => {
      printWindow.print();
    }, 250);
  };
}
