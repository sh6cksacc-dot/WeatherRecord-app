(function(){
  const english=/^en(?:-|$)/i.test(navigator.language||'');
  const dict={
    appName:english?'Weather Record':'气象唱片',
    brand:english?'Weather Record <span>WEATHER RECORD</span>':'气象唱片 <span>WEATHER RECORD</span>',
    locating:english?'Locating':'正在定位', eyebrow:english?"TODAY'S RANDOM RECORD":'今日随机唱片',
    heroTitle:english?'Let the weather choose\u003cbr\u003e\u003cem>a record for you.</em>':'让当下的天气，\u003cbr\u003e\u003cem>替你选一张唱片。</em>',
    intro:english?'Every opening reads the time, light and air to find the right album for this moment.':'每一次打开，都会根据此刻的时间、光线与空气，从你的听觉天气库里捞出一张刚刚好的专辑。',
    localTime:english?'LOCAL TIME':'本地时间',weather:english?'WEATHER':'天气',today:english?'TODAY':'今天',
    readingPeriod:english?'Reading time':'正在读取时段',readingWeather:english?'Reading weather':'正在读取天气',welcomeToday:english?'A Brand new day':'崭新之日',
    waiting:english?'One moment—the sky is choosing a record.':'稍等，让天空给我们一个提示。',play:english?'Play':'播放',lyricsCaption:english?'LYRICS · TAP TO RETURN':'歌词 · 点按返回封面',lyricsIdle:english?'Play a song to view lyrics':'播放歌曲后显示歌词',curated:english?'CURATED BY THE SKY':'由天空策展',updated:english?'Updated':'更新时间'
  };
  window.WEATHER_RECORD_LOCALE={english,t:(key)=>dict[key]||key};
  document.documentElement.lang=english?'en':'zh-CN';
  document.querySelectorAll('[data-i18n]').forEach(el=>{const key=el.dataset.i18n;if(dict[key])el.innerHTML=dict[key]});
})();
