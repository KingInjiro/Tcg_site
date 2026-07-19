const html = `</td></tr></table><!--msnavigation--></td></tr><!--msnavigation--></table><!--msnavigation--><table border="0" cellpadding="0" cellspacing="0" width="100%"><tr><td>245:</td></tr><!--msnavigation--></table></body>`;
const result = html.replace(/<!--msnavigation--><\/td><\/tr><!--msnavigation--><\/table>/g, '<!--msnavigation--></td><td valign="top" width="250" class="ad-sidebar"><div class="ad-placeholder">Место для рекламы</div></td></tr><!--msnavigation--></table>');
console.log(result);
