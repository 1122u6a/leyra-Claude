const copyButton = document.querySelector('[data-copy-group]');
if (copyButton) {
  copyButton.addEventListener('click', async () => {
    const status = document.querySelector('[role="status"]');
    try {
      await navigator.clipboard.writeText('1136427075');
      status.textContent = '已复制 QQ 群号。';
    } catch {
      status.textContent = '请手动复制群号 1136427075。';
    }
  });
}
