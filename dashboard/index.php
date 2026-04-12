<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Sensor Dashboard</title>
    <link rel="stylesheet" href="assets/css/style.css">
</head>
<body>

<!-- Top bar -->
<div class="topbar">
    <h1>Sensor Dashboard</h1>
    <div class="topbar-controls">
        <button class="range-btn" data-range="1h">1H</button>
        <button class="range-btn" data-range="6h">6H</button>
        <button class="range-btn active" data-range="24h">24H</button>
        <button class="range-btn" data-range="7d">7D</button>
        <button class="range-btn" data-range="30d">30D</button>
        <button class="refresh-btn" id="refreshBtn" title="Refresh now">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M14 8A6 6 0 1 1 8 2" stroke-linecap="round"/>
                <path d="M14 2v4h-4" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
        </button>
        <span class="auto-refresh">
            <span class="auto-refresh-dot"></span> Auto 60s
        </span>
    </div>
</div>

<!-- Main content: dynamically populated by JS -->
<div class="main" id="mainContent">
    <div class="loading-state" id="globalLoading">
        <div class="loading-spinner"></div>
        <div>Loading sensors...</div>
    </div>
</div>

<!-- Chart.js from CDN -->
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.7/dist/chart.umd.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/chartjs-adapter-date-fns@3.0.0/dist/chartjs-adapter-date-fns.bundle.min.js"></script>
<script src="assets/js/dashboard.js"></script>
</body>
</html>
