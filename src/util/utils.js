import Gio from "gi://Gio";
import Soup from "gi://Soup";
import GLib from "gi://GLib";

const BASE_URL = "https://opentdb.com";

Gio._promisify(
  Soup.Session.prototype,
  "send_and_read_async",
  "send_and_read_finish",
);

const httpSession = new Soup.Session();

export const settings = Gio.Settings.new(pkg.name);

export function parseTriviaCategories(categories) {
  const categoriesMap = new Map();

  for (const categoryObject of categories) {
    if (categoryObject.name.includes(":")) {
      let [category, name] = categoryObject.name.split(":");

      category = category.replaceAll("&", "And").trim();
      name = name.replaceAll("&", "And").trim();

      categoryObject.name = name;
      categoryObject.hasChildren = false;
      categoryObject.children = [];

      if (!categoriesMap.has(category)) {
        categoriesMap.set(category, [categoryObject]);
        continue;
      }

      categoriesMap.get(category).push(categoryObject);
      continue;
    }

    categoryObject.hasChildren = false;
    categoryObject.children = [];
    categoryObject.name = categoryObject.name.replaceAll("&", "And");
    categoriesMap.set(categoryObject.name, categoryObject);
  }

  const parsedCategories = [];
  let id = 900;

  for (const [key, value] of categoriesMap.entries()) {
    if (Array.isArray(value)) {
      const categoryObject = {
        id: ++id,
        name: key,
        hasChildren: true,
        children: value,
      };
      parsedCategories.push(categoryObject);
      continue;
    }

    parsedCategories.push(value);
  }

  return parsedCategories;
}

export function shuffle(array) {
  let currIdx = array.length,
    tempVal,
    randIdx;
  while (0 !== currIdx) {
    randIdx = Math.floor(Math.random() * currIdx);
    currIdx -= 1;
    tempVal = array[currIdx];
    array[currIdx] = array[randIdx];
    array[randIdx] = tempVal;
  }

  return array;
}

export async function fetchData(url) {
  try {
    const message = Soup.Message.new("GET", url);

    const bytes = await httpSession.send_and_read_async(
      message,
      GLib.PRIORITY_DEFAULT,
      null,
    );

    if (message.get_status() !== Soup.Status.OK) {
      console.error(`HTTP Status ${message.get_status()}`);
      throw new Error("Failed to fetch data");
    }

    const textDecoder = new TextDecoder("utf-8");
    const decodedText = textDecoder.decode(bytes.toArray());
    const data = JSON.parse(decodedText);

    return data;
  } catch (error) {
    console.error(error);
    throw new Error(error);
  }
}

export function getQuestionCount(data, difficulty) {
  const {
    total_question_count: total,
    total_easy_question_count: easy,
    total_medium_question_count: medium,
    total_hard_question_count: hard,
  } = data.category_question_count;

  switch (difficulty) {
    case "mixed":
      return total;
    case "easy":
      return easy;
    case "medium":
      return medium;
    case "hard":
      return hard;
    default:
      throw new Error("An error occurred while retrivieving question count");
  }
}

function getQuizCountForEachReq(totalQuiz) {
  const quizCountPerBatch = [];
  while (totalQuiz >= 50) {
    quizCountPerBatch.push(50);
    totalQuiz -= 50;
  }
  if (totalQuiz > 0) {
    quizCountPerBatch.push(totalQuiz);
  }
  return quizCountPerBatch;
}

export async function fetchQuiz(category, difficulty) {
  try {
    const tokenUrl = `${BASE_URL}/api_token.php?command=request`;
    const quizCountUrl = `${BASE_URL}/api_count.php?category=${category}`;

    const [tokenData, quizCount] = await Promise.all(
      [tokenUrl, quizCountUrl].map(async (url) => {
        const responseData = await fetchData(url);
        return responseData;
      }),
    );

    if (!tokenData || !quizCount) {
      throw new Error("An error occurred while fetching token and quiz count");
    }

    const count = getQuestionCount(quizCount, difficulty);
    // FIXME: Getting a maximum of 50 questions at the moment
    // Increase to get all questions and save them client side 
    // in a database.
    const quizCountForEachReq = getQuizCountForEachReq(count > 50 ? 50 : count);
    let quizUrl;

    if (difficulty === "mixed") {
      quizUrl = `${BASE_URL}/api.php?category=${category}&token=${tokenData.token}`;
    } else {
      quizUrl = `${BASE_URL}/api.php?category=${category}&difficulty=${difficulty}&token=${tokenData.token}`;
    }

    const urls = quizCountForEachReq.map((url) => `${quizUrl}&amount=${url}`);

    const data = await Promise.all(
      urls.map(async (url) => {
        const data = await fetchData(url);
        return data?.results ?? [];
      }),
    );

    return data.flat(1);
  } catch (error) {
    console.error(error);
    throw new Error(error);
  }
}

export function formatData(data) {
  for (let i = 0; i < data.length; i++) {
    const { correct_answer, incorrect_answers, question } = data[i];
    incorrect_answers.push(correct_answer);

    const answers = incorrect_answers.map((answer) => {
      return {
        answer: __LIB__.decode(answer),
        active: false,
        sensitive: true,
        css_classes: [""],
      };
    });

    const shuffledAnswers = shuffle(answers);
    if (shuffledAnswers.length < 4) {
      const answer = {
        answer: "",
        active: false,
        sensitive: true,
        css_classes: [""],
      };

      shuffledAnswers.push({ ...answer }, { ...answer });
    }

    data[i].answers = shuffledAnswers;
    data[i].submit_button_sensitive = false;
    data[i].question = __LIB__.decode(question);
    data[i].correct_answer = __LIB__.decode(correct_answer);
  }

  return shuffle(data);
}

export function generateMetadata(categories) {
  const metadata = {};
  const difficulty = ["mixed", "easy", "medium", "hard"];

  for (const category of categories) {
    const difficultyObject = {};

    for (const d of difficulty) {
      difficultyObject[d] = { updatedOn: 0, saved: false };
    }

    metadata[category.id] = difficultyObject;
  }

  return metadata;
}

export function getCustomFilter(string) {
  return (item) => {
    if (item.hasChildren) return true;
    return item.name.toLocaleLowerCase().includes(string);
  };
}
