/** Only explicit, standalone requests for authoring help bypass business search. */
export function isOperationGuideQuestion(question: string): boolean {
  const text = question.normalize('NFKC').replace(/\s/gu, '').replace(/[?？!！。]+$/u, '');
  return /^(?:組立の?)?手順書(?:の(?:作り方|編集方法|登録方法|作成方法)(?:を(?:教えて|知りたい))?|(?:は|を|って)?どうやって(?:作る|編集する|登録する)(?:の|んですか|のですか)?|を(?:作りたい|作成したい|編集したい|登録したい))$/u.test(text);
}
