const topics = {
  presentation: [
    "Pouvez-vous vous présenter en une minute ?",
    "J’ai travaillé sur [expérience liée au poste]. Mon rôle était de [responsabilité précise]. J’ai notamment réalisé [action concrète], ce qui a permis [résultat observé]. Ce poste m’intéresse parce qu’il me permettrait de mettre cette expérience au service de [une priorité de l’offre].",
    ["Présentez l’expérience la plus pertinente en premier.", "Terminez en reliant votre exemple au poste."],
  ],
  situation: [
    "Racontez une situation où vous avez dû gérer un imprévu.",
    "Lorsque [imprévu] est arrivé, je devais [objectif]. J’ai vérifié [information] et décidé de [action], puis j’ai prévenu [personnes concernées]. Cela a permis [résultat]. Depuis, je [amélioration que vous avez réellement adoptée].",
    ["Décrivez ce que vous avez décidé personnellement.", "Indiquez un résultat observable."],
  ],
  achats: [
    "Comment gérez-vous un retard fournisseur qui menace une livraison ?",
    "Je commence par vérifier le stock disponible, la nouvelle date promise et les commandes prioritaires. Je demande au fournisseur ce qu’il peut livrer partiellement. Avec les équipes concernées, je compare ce scénario avec les solutions de remplacement. Je communique ensuite une date réaliste et fixe un point de contrôle.",
    ["Expliquez comment vous priorisez les commandes.", "Précisez à qui vous signalez le risque et à quel moment."],
  ],
};
const $ = id => document.getElementById(id);
const topic = $("demo-topic");
const result = $("demo-result");
function updateQuestion() {
  $("demo-question").textContent = topics[topic.value][0];
  result.hidden = true;
}
if (Object.hasOwn(topics, location.hash.slice(1))) topic.value = location.hash.slice(1);
updateQuestion();
topic.addEventListener("change", updateQuestion);
$("demo-form").addEventListener("submit", event => {
  event.preventDefault();
  const [, example, notes] = topics[topic.value];
  $("demo-example").textContent = example;
  $("demo-notes").replaceChildren(...notes.map(note => {
    const item = document.createElement("li");
    item.textContent = note;
    return item;
  }));
  result.hidden = false;
  result.focus();
});
