/** 浏览器侧触发文件下载。单独抽出，避免各处各写一遍 <a download> 和 URL 生命周期。 */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
  // 立刻 revoke 会让部分浏览器来不及发起下载，留一点余量
  window.setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function downloadBytes(bytes: ArrayBuffer, mime: string, filename: string): void {
  downloadBlob(new Blob([bytes], { type: mime }), filename);
}
