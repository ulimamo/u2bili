import axios from 'axios';
import { XMLParser } from "fast-xml-parser";

const parser = new XMLParser();

export async function translate (sourceText) {
    let baseText = sourceText.replace('SUB)', '');
    const { data } = await axios.get(`http://api.microsofttranslator.com/v2/Http.svc/Translate?appId=AFC76A66CF4F434ED080D245C30CF1E71C22959C&from=&to=zh-cn&text=${encodeURI(baseText)}`);
    let jObj = parser.parse(data);
    return jObj.string;
}