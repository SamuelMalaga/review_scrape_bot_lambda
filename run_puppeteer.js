const chromium = require("@sparticuz/chromium");
const puppeteer = require("puppeteer-core");
const AWS = require('aws-sdk');

const S3 = new AWS.S3();

function parseAndFormatXhrResponses(XhrArray){
  const reviewDataArray = [];
  XhrArray.forEach(XhrResponseObj => {
    //console.log(XhrResponseObj.data);
    //console.log(XhrResponseObj.data)
    const trimmedResponseData = XhrResponseObj.data.slice(4);
    const responseDataArray = JSON.parse(trimmedResponseData);
    const reviewsArray = responseDataArray[2];
    reviewsArray.forEach(reviewObj => {
          const userName = reviewObj[0][1];
          const timeOfReview = reviewObj[1];
          const reviewContent = reviewObj[3];
          const reviewRating = reviewObj[4];
          const reviewLang = reviewObj[32];
          const reviewId = reviewObj[10];
          reviewDataArray.push({
            userName,
            timeOfReview,
            reviewContent,
            reviewRating,
            reviewLang,
            reviewId
          })
        });
      const JsonFormattedArray = JSON.stringify(reviewDataArray);
      // Escreva os dados em um arquivo JSON localmente
      //fs.writeFileSync('browserParsedResponses.json', JsonFormattedArray, 'utf-8');
  });

  console.log(reviewDataArray.length, " Reviews coletadas");
  return reviewDataArray;
  //console.log(reviewDataArray)
}
async function findAndClickOnMoreReviewButton(ButtonsList) {
  console.log("Acessou a findAndClickOnMoreReviewButton");

  // Use page.evaluate para filtrar os botões com base na aria-label
  const filteredButtons = await page.evaluate(async (buttons) => {
    const filtered = [];
    for (const button of buttons) {
      const ariaLabel = await button.evaluate((el) => el.getAttribute('aria-label'));
      if (ariaLabel && (ariaLabel.includes('Mais avaliações') || ariaLabel.includes('More Reviews'))) {
        filtered.push(button);
      }
    }
    return filtered;
  }, ButtonsList);

  // Clique no primeiro botão filtrado (se existir)
  if (filteredButtons.length > 0) {
    const buttonElement = filteredButtons[0];
    const buttonText = await buttonElement.evaluate(element => element.textContent);
    console.log("Clicando no botão com a aria-label contendo 'Mais avaliações' ou 'More Reviews'", buttonText);
    await buttonElement.click();
  } else {
    console.log('Nenhum botão com a aria-label contendo "Mais avaliações" ou "More Reviews" encontrado na página.');
  }
}
async function findMainReviewSection(page, mainDivSelector) {
  const divElement = await page.$(mainDivSelector);

  if (divElement) {
    console.log('Div pai encontrada');
    return divElement;
  } else {
    console.log('Div pai não encontrada');
    return null;
  }
}
async function findInnerReviewSectionAndScroll(page, innerDivElement, scrollN, scrollAll = false) {
  if (innerDivElement) {
    console.log('Fazendo scroll na div filha');
    await new Promise(r => setTimeout(r, 2000));

    console.log("ScrollN dentro da função", scrollN)

    const MaxScrollN = scrollN

    let previousHeight = 0;
    let currentHeight = await page.evaluate(element => element.scrollTop = element.scrollHeight, innerDivElement);

    if (scrollAll) {
      while (previousHeight !== currentHeight) {
        previousHeight = currentHeight;
        await page.evaluate(element => element.scrollTop = element.scrollHeight, innerDivElement);

        await new Promise(resolve => setTimeout(resolve, 6000));

        currentHeight = await page.evaluate(element => element.scrollTop = element.scrollHeight, innerDivElement);
      }
    } else {
      for (let i = 0; i < scrollN; i++) {
        const scrollHeightDebug = await page.evaluate(element => element.scrollTop = element.scrollHeight, innerDivElement);
        await new Promise(resolve => setTimeout(resolve, 4000));
        //console.log(`iteração ${i} do loop, tamanho da scrolldiv: ${scrollHeightDebug}`)
      }
    }
  } else {
    console.log('Div filha com tabindex igual a -1 não encontrada dentro da div pai.');
  }
}
function getTimeStamp(){
  const currentDate = new Date();

  const day = String(currentDate.getDate()).padStart(2, '0');
  const month = String(currentDate.getMonth() + 1).padStart(2, '0'); // Mês começa em 0 (janeiro)
  const year = currentDate.getFullYear();
  const hours = currentDate.getHours();
  const minutes = currentDate.getMinutes();
  const seconds = currentDate.getSeconds();

  const formattedDateFileName =`DD:${day}_MM:${month}_YY:${year}_at_${hours}:${minutes}:${seconds}`

  return formattedDateFileName
}
async function uploadContentToFailsafe(newFileNameKey, fileContent){

  try {
    const params = {
      Bucket: "webscraper-failsafe",
      Key: newFileNameKey,
      Body:JSON.stringify(fileContent),
      ContentType:'application/json; charset=utf8'
    }
    await S3.putObject(params).promise();
    console.log("upload complete")
  } catch (error) {
    console.log(error);
    console.log("failed upload",error)

  }
}

module.exports.handler = async (event) => {
  const browser = await puppeteer.launch({
    args: chromium.args,
    defaultViewport: chromium.defaultViewport,
    executablePath: await chromium.executablePath(),
    headless: chromium.headless,
    ignoreHTTPSErrors: true,
  });

  const fileSafeNamePrefix = getTimeStamp();

  const failSafeFileName = `fail_safe_json_Scraped_at_${fileSafeNamePrefix}.json`

  const xhrRequests = [];

  const xhrResponses = [];

  let totalScrolls = 0

  //Abre o browser
  console.log('Browser Aberto');
  const page = await browser.newPage();

  await page.setViewport({
    width: 642,
    height: 947,
  })

  //Navega até o link
  console.log('Navegou até o link');
  await page.goto("https://www.google.com/maps/place/Nema/@-22.9841517,-43.2128543,15z/data=!4m5!3m4!1s0x0:0x4c1eb56d62eb469b!8m2!3d-22.9841517!4d-43.2128543?shorturl=1");

  //Seta a captura das requisições
  await page.setRequestInterception(true);

  // Intercepte todas as requisições de rede
  page.on('request', (request) => {
    //Captura a requisição caso ela seja do tipo xhr e possui no url '/review/listentitiesreviews'
    if (request.resourceType() === 'xhr' && request.url().includes('/review/listentitiesreviews')) {
      xhrRequests.push(request);
    }

    // Continue com a requisição
    request.continue();
  });

  // Intercepta todas as respostas
  page.on('response', async (response) => {
    // Verifica se a resposta da requisição é de um XHR e possui no url '/review/listentitiesreviews'
    if (response.request().resourceType() === 'xhr' && response.request().url().includes('/review/listentitiesreviews')) {
      const url = response.url();
      const status = response.status();
      const data = await response.text();

      // Armazena os dados da resposta no array
      xhrResponses.push({
        url,
        status,
        data,
      });
    }
  });

  const buttonsList = await page.$$('button');


  console.log("Localizando o button");

  const filteredButtons = [];
  for (const button of buttonsList) {
    const ariaLabel = await page.evaluate(element => element.getAttribute('aria-label'), button);
    if (ariaLabel && (ariaLabel.includes('Mais reviews') || ariaLabel.includes('More reviews'))) {
      console.log("button encontrado")
      filteredButtons.push(button);
    }
  }

  if (filteredButtons.length > 0) {
    const buttonElement = filteredButtons[0];
    const buttonText = await page.evaluate(element => element.textContent, buttonElement);

    const regex = /\((\d+)\)/;
    const correspondencia = regex.exec(buttonText);
    //PEGA O NUMERO TOTAL DE SCROLLS
    if (correspondencia && correspondencia.length > 1) {
      const numero = parseInt(correspondencia[1], 10);
      totalScrolls = Math.ceil(numero / 10);
      console.log("Total de scrolls:", totalScrolls);
    } else {
      console.log("Nenhuma correspondência encontrada.");
    }
    console.log("Clicando no botão com a aria-label contendo 'Mais reviews' ou 'More reviews'", buttonText);
    await buttonElement.click();
  } else {
    console.log('Nenhum botão com a aria-label contendo "Mais reviews" ou "More reviews" encontrado na página.');
  }



  const mainDivSelector = 'div[aria-label="Nema"][role="main"]';
  const mainDivElement = await findMainReviewSection(page, mainDivSelector);

  const innerDivSelector = 'div[tabindex="-1"]';
  const innerDivElement = mainDivElement ? await mainDivElement.$(innerDivSelector) : null;

  await findInnerReviewSectionAndScroll(page, innerDivElement, totalScrolls);

  //browser.close hanging workaround
  const pages = await browser.pages();
  for (const page of pages) {
    await page.close();
  }
  await browser.close();
  console.log('Fechou o browser');

  console.log('Formatando as respostas xhr');
  const ScrapedResult = parseAndFormatXhrResponses(xhrResponses);

  await uploadContentToFailsafe(failSafeFileName, ScrapedResult);

  return {
    statusCode: 200,
    body: JSON.stringify(
      {
        message: ScrapedResult,
        input: event,
      },
      null,
      2
    ),
  };
};
