/**
 * Welcome to Cloudflare Workers! This is your first worker.
 *
 * - Run `npm run dev` in your terminal to start a development server
 * - Open a browser tab at http://localhost:8787/ to see your worker in action
 * - Run `npm run deploy` to publish your worker
 *
 * Learn more at https://developers.cloudflare.com/workers/
 */

function isRedBookLink(url) {
	return true;
}

async function getHtmlString(url) {
	async function gatherResponse(response) {
		return response.text();
	}

	const init = {
		headers: {
			'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.9 ',
			'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/55.0.2883.87 UBrowser/6.2.4098.3 Safari/537.36',
			'Cookie': 'xsecappid=xhs-pc-web; a1=1889603ac262zghcxe2e7saspbpx9vfq55e0grxp150000875832; webId=b3ad35cfecf858e8a69581931536c4c6; gid=yYYjK8q0fd2yyYYjK8q0S2FCJKJukxSCdJdWdUyM0MUDU828CjhiAk888YW2YqJ8jJ8Wfd02; gid.sign=WQqNVEKS/EDmVdRmou2ca3DdxPA=; web_session=0400698e3d537857a68cc3ccb5364b5bcc9fa3; webBuild=2.13.0; cache_feeds=[]; websectiga=f47eda31ec99545da40c2f731f0630efd2b0959e1dd10d5fedac3dce0bd1e04d; sec_poison_id=a983a1e5-dcf5-4538-affd-01a32dde1698'
		}
	};
	const response = await fetch(url, init);
	return await gatherResponse(response);
}

function parseNoteInfoFromRedBookHtml(htmlString) {
	const prefix = '<script>window.__INITIAL_STATE__=';
	const suffix = '<\/script>';
	const pattern = `${prefix}[\\s\\S]*?${suffix}`;
	let scriptTags = htmlString.match(new RegExp(pattern, 'g'));
	let noteInfo = null;
	if (scriptTags.length !== 0) {
		let label = scriptTags[0];
		let rawInfo = label.substring(prefix.length, label.length - suffix.length);
		rawInfo = rawInfo.replace(/undefined/g, 'null');
		noteInfo = JSON.parse(rawInfo);
	}
	return noteInfo;
}

function page(error_message, title, imageList, video) {
	let content = `
        <!DOCTYPE html>
        <html lang='en'>
        <head>
        		<meta charset='utf-8'>
        		<meta name='viewport' content='width=device-width, initial-scale=1'>
            <title>Redbook media watermark removal</title>
                <link href='https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css' rel='stylesheet' >
        </head>
        <body style='background-color: rgb(70, 73, 104); padding: 20px'>
            <div class='container text-center'>
            <div class='col-11' style='max-width: 684px'>
            	<div class='row'>
                <p class='text-danger'>${error_message}</p>
							</div>
							<div class='row'>
                <input type='text' id='linkInput' class='form-control' placeholder='Enter link'>
                <button id='confirmButton' class='btn btn-primary mt-2'>Confirm</button>
							</div>
							<div class='content' style='margin-top: 30px'></div>
                <h3>${title}</h3>
                <div class='col mt-4' style='width: '>
    `;

	// Loop through the image list and create a card for each image, if imageList is not null
	if (imageList !== null) {
		for (let image of imageList) {
			content += `
                <div class='card' style='margin-top: 20px'>
									<img src='${image.href}' class='card-image-top image-fluid' alt='Image' style='height: ${image.height}; width: ${image.width};'>
									<div class='card-body'>
											<a href='${image.href}' download class='btn btn-primary'>Download Image</a>
									</div>
                </div>
            `;
		}
	}

	// Add the video, if video is not null
	if (video !== null) {
		content += `
            <div>
                <div>
                    <video src='${video.href}' class='card-img-top' style='height: ${video.height}; width: ${video.width};' controls></video>
                    <div>
                        <a href='${video.href}' download class='btn btn-primary'>Download Video</a>
                    </div>
                </div>
            </div>
        `;
	}

	content += `
                </div>
							</div>
            </div>
            <script>
                document.getElementById('confirmButton').addEventListener('click', function() {
                    let link = document.getElementById('linkInput').value;
                    window.location.href = '/?link=' + encodeURIComponent(link)
                });
            </script>
        </body>
        </html>
    `;

	return content;
}


export default {
	async fetch(request, env, ctx) {
		const { pathname, searchParams } = new URL(request.url);
		if (request.method !== 'GET') {
			return new Response('Method Not Allowed', { status: 403 });
		}

		switch (pathname) {
			case '/': {
				let link = searchParams.get('link');
				if (link === null || link === '') {
					let htmlResp = page('', '', [], null);
					return new Response(htmlResp, { status: 200, headers: { 'content-type': 'text/html;charset=UTF-8' } });
				}
				if (!isRedBookLink(link)) {
					return new Response('not valid link', { status: 403 });
				}
				let htmlString = await getHtmlString(link);
				let noteInfo = parseNoteInfoFromRedBookHtml(htmlString);
				let note = noteInfo['note']['note'];
				let imageList = note['imageList'];
				let proxyImageList = [];
				for (let imageIdx in imageList) {
					let image = imageList[imageIdx];
					proxyImageList.push({
						href: `/image?traceId=${image.traceId}`,
						height: image.height,
						width: image.width
					});
				}
				let video = null;
				if ('video' in note && note.video !== null) {
					let rawVideo = note['video'];
					let originVideoKey = rawVideo['consumer']['originVideoKey'];
					let stream = rawVideo['media']['stream'];
					let encoderInfo = null;
					for (let encoder of ['av1', 'h264', 'h265']) {
						encoderInfo = stream[encoder];
						if (encoderInfo.length !== 0) {
							encoderInfo = encoderInfo[0];
							break;
						}
					}
					let url = `/video?key=${originVideoKey}&format=${encoderInfo.format}`;
					video = {
						href: url,
						height: encoderInfo.height,
						width: encoderInfo.width
					};
				}

				let index = page('', note['title'], proxyImageList, video);
				return new Response(index, { status: 200, headers: { 'content-type': 'text/html;charset=UTF-8' } });
			}
			case '/image': {
				let traceId = searchParams.get('traceId');
				if (traceId !== null && traceId !== '') {
					let picUrl = `https://sns-img-qc.xhscdn.com/${traceId}`;

					let response = await fetch(picUrl, {
						headers: {
							'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/55.0.2883.87 UBrowser/6.2.4098.3 Safari/537.36',
							'Accept': '*/*'
						}
					});

					let newHeaders = new Headers(response.headers);
					newHeaders.set('Content-Disposition', `attachment; filename=${traceId}.jpg`);
					return new Response(
						response.body,
						{
							status: response.status,
							statusText: response.statusText,
							headers: newHeaders
						}
					);
				}
				return new Response('download image error', { status: 500 });
			}
			case '/video': {
				let key = searchParams.get('key');
				if (key !== null && key !== '') {
					let basename = key.split('/').pop();
					let format = searchParams.get('format');
					let url = `https://sns-video-qc.xhscdn.com/${key}`;
					let reqHeaders = new Headers(request.headers);
					reqHeaders.delete('referer');
					reqHeaders.delete('connection');
					let response = await fetch(url, {
						headers: reqHeaders
					});

					let newHeaders = new Headers(response.headers);
					newHeaders.set('Content-Disposition', `inline; attachment; filename=${basename}.${format}`);
					return new Response(
						response.body,
						{
							status: response.status,
							statusText: response.statusText,
							headers: newHeaders
						}
					);
				}
				return new Response('download video error', { status: 500 });

			}
		}
		return new Response('Not Found', { status: 404 });
	}
};
