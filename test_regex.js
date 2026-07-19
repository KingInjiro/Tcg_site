const html = `<a href="news.html" language="JavaScript" onmouseover="if(MSFPhover) document['MSFPnav1'].src=MSFPnav1h.src" onmouseout="if(MSFPhover) document['MSFPnav1'].src=MSFPnav1n.src"><img src="/derived/NEWS.HTM_CMP_-1-010_VBTN.GIF" width="132" height="18" border="0" alt="Новости" name="MSFPnav1"></a>`;
const result = html.replace(/<a href="([^"]+)"[^>]*><img src="\/derived\/[^"]+_VBTN(?:_A)?\.GIF"[^>]*alt="([^"]+)"[^>]*><\/a>/gi, '<a href="$1" class="modern-nav-btn">$2</a>');
console.log(result);
