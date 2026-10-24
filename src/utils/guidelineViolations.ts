/**
 * Explanations for Grindr's community-guidelines codes, worded after the
 * official app's banned_warning_v2_* / banned_reason_* / timed_bans_* /
 * ban_appeal_*_community_guideline_* strings. Warnings (GET /v2/warnings)
 * and bans (banSubReason / banDetails.subReason) use different code sets
 * with different tone: a warning says "don't do it again", a ban explains
 * why the account is blocked.
 */

import { openUrl } from "@tauri-apps/plugin-opener";

export const COMMUNITY_GUIDELINES_URL = "https://www.grindr.com/community-guidelines";

export function openCommunityGuidelines() {
	openUrl(COMMUNITY_GUIDELINES_URL).catch(() => window.open(COMMUNITY_GUIDELINES_URL, "_blank"));
}

type Translate = (key: string, options?: Record<string, unknown>) => string;

/**
 * Sections of the community guidelines, keyed by the i18n id under
 * community_guidelines. `text` is paragraphs separated by blank lines;
 * lines starting with "• " are list items.
 */
const GUIDELINES: Record<string, { title: string; text: string }> = {
	authentic: {
		title: "Be authentic",
		text: "Be yourself on the app, not someone else. Any profiles impersonating other people, including celebrities, will be banned. Content that you post on Grindr should be of you or by you, and you should represent yourself truthfully. You choose what to disclose about yourself, but the information that you do share should be true. Any impersonation/catfishing is prohibited and may result in a ban.\n\nWe don't allow:\n• Photos of celebrities or public figures of any kind (actors, musicians, politicians, etc.)\n• Photos of celebrity impersonators where it could be unclear if the person is an impersonator or the actual celebrity\n• Pictures that are copyrighted, have watermarks, or that we believe to not be of you or taken by you\n• Junk photos (like solid black boxes)\n\nIf your profile is reported as being fake, we may ask you to verify your identity to keep your profile active.",
	},
	harassment: {
		title: "Harassment",
		text: "We want you to be yourself and express yourself freely here, but not at the expense of someone else. We strongly suggest you talk about what you are into, not what you aren't, on your profile. And the old adage \"if you can't say something nice, don't say anything at all\" pertains here just like at your grandmother's.\n\nWe also expect you to leave someone alone when they indicate they want to be left alone. This is a foundational rule. Misusing our reporting system to get back at someone who's blocked you, or creating new accounts to continue patterns of unwanted contact will result in a permanent ban.",
	},
	hate: {
		title: "Hate, violence, and offensive content",
		text: "It should go without saying, but we don't allow hate speech or violence of any kind. If we learn that you have abused or seriously threatened another user, you will be banned forever. We may also remove content that we find too graphic, offensive, or insensitive and hurtful, even if there was no ill intent.\n\nWe take reports of violence, threats and assault very seriously. This includes incidents that occur both on and off our platform.\n\nWe may consider content hate speech (and take more severe actions against a profile) if it promotes or condones racism, bigotry, violence, hate, dehumanization, or harm against individuals or groups based on race, ethnicity, disability, age, nationality, sexual orientation, gender, gender identity, religion, or appearance.\n\nContent we would consider graphic, violent or offensive includes but is not limited to:\n• Photos of weapons and firearms (real or toy), including paintball guns\n• Photos with blood or gore, including especially realistic costumes\n• Violent images, including cartoons or illustrations\n• Gang signs or offensive hand gestures (e.g. middle finger)\n• Kink or fetish content that is violent or promotes harm\n• Threats against any person or group, including political figures\n• Photos or descriptions of self-harm or suicide\n• Photos of dead animals, including hunting photos\n• Jokes or memes that can be found to be hurtful and insensitive",
	},
	minors: {
		title: "Minors",
		text: "Grindr is for adults ONLY. You must be at least 18 to use the app (or older in certain jurisdictions). We take this age limit very, very seriously, and any violation or suspected violation will result in a ban, at a minimum, and could lead us to involve the appropriate authorities.\n\nWe also do not allow any photos of anyone under 18, in any context. This includes photos where a minor's face is blurred out or is in the background. Our total ban on minor activity extends to communication: if a user communicates with another user that they believe to be under 18, that is also a violation of our age policy.",
	},
	obey_the_law: {
		title: "Obey the law",
		text: "If something is illegal offline, well guess what: it's also illegal on Grindr! Yes, this includes drugs. Illegal content and depictions of illegal activity will be taken down and, when appropriate, reported to the appropriate authorities.\n\nWe allow casual mentions of marijuana, over the counter medication, and prescribed medications. However, evidence of misuse or encouraging others to use irresponsibly, as well as any discussion of buying/selling, will result in a ban. We do not allow any mention of non-prescription drugs, other than marijuana, unless in the context of addiction recovery. Also, we do not allow profiles mainly focused on drug content.",
	},
	private_information: {
		title: "Private information",
		text: "Grindr will never ask you for personal details like your password or your credit card information. Other users don't need to know this stuff either. In the interest of safety, we will remove any sensitive personal information displayed publicly, such as phone numbers and addresses, and we may suspend or ban the profile.\n\nUnwelcome solicitation of another user's personal information, prompting users to visit outside links, or any kind of spamming or scamming will get you banned.\n\nWe do not allow the posting of private information anywhere on the profile, such as photos or profile text, or direct links to it, for example through a QR code or link. Private information includes:\n• Unlisted contact information, such as phone numbers, email addresses, home/work address\n• Social security numbers, passports, passwords, financial information",
	},
};

interface WarningEntry {
	codes: string[];
	title: string;
	/** Always shown: what the rule is. */
	content: string;
	/** Behind "Why am I seeing this?". */
	reason: string;
	/** Longer explanation of the rule, also behind the disclosure. */
	details?: string;
	guideline?: keyof typeof GUIDELINES;
}

function flaggedFor(what: string): string {
	return `You are seeing this warning because you were flagged for ${what} in a recent interaction. If our moderation team receives reports about other incidents, your account may be banned for violating our Community Guidelines.`;
}

/** Keyed by the i18n id under account_warnings.types; `codes` are Grindr's wire values. */
const WARNING_TYPES: Record<string, WarningEntry> = {
	harassment: {
		codes: ["HARASSMENT"],
		title: "Harassment",
		content: "We encourage free expression, but not if it bullies or intimidates others. Please be kind on Grindr.",
		reason: flaggedFor("harassment"),
		details:
			"We ask that you treat others with kindness on Grindr. Bullying, harassment, and intimidation are prohibited, as they create a hostile environment. Repeated abusive behavior may result in further actions against your account.",
		guideline: "harassment",
	},
	commercial: {
		codes: ["COMMERCIAL"],
		title: "Commercial activity",
		content:
			"Grindr is for personal use only. We can’t allow you to ask for money, advertise, or use Grindr to buy or sell anything. If this happens again, you may be banned.",
		reason: flaggedFor("commercial activity"),
		details:
			"Grindr is designed for personal connections, not for recruiting or soliciting users for profit-driven ventures like promoting businesses, paid services, or events. Such activities detract from the platform’s purpose and go against our guidelines. Please ensure your interactions remain personal and non-commercial.",
	},
	mild_insults: {
		codes: ["MILD_INSULTS"],
		title: "Mild insults and disrespect",
		content:
			"Some chats you’ve sent have been flagged as potentially disrespectful. While we encourage you to be yourself and express yourself freely on Grindr, it’s important to do so without negatively impacting others. Please be kind on Grindr, and ensure your interactions remain respectful in alignment with our community guidelines.",
		reason: flaggedFor("mild insults and disrespect"),
		details:
			"Grindr seeks to provide a space for respectful and authentic interactions. Comments that may seem unkind or disrespectful can negatively impact others and go against our community guidelines. Please be mindful of how your words come across and help us maintain a welcoming environment for everyone. Continued violations may result in account actions like suspension or ban.",
		guideline: "harassment",
	},
	general_advertising: {
		codes: ["GENERAL_ADVERTISING"],
		title: "General advertising and solicitation",
		content:
			"Grindr is for authentic personal connections, not for advertising goods, services, or external platforms. Promotional content is not allowed in profiles or messages. Please ensure your interactions remain genuine and aligned with our guidelines.",
		reason: flaggedFor("general advertising and solicitation"),
		details:
			"Grindr is designed for genuine personal connections and is not a space for promoting goods, services, or external links. Using profiles or messages to promote products, services, or share external links goes against our guidelines and disrupts the experience for others. Please remove any promotional content to keep Grindr a space for genuine interactions.",
		guideline: "private_information",
	},
	unwanted_messaging: {
		codes: ["UNWANTED_MESSAGING"],
		title: "Repeated or unwanted messaging",
		content:
			"Slow down! Sending repeated messages or excessive follow-ups is considered spammy behavior. Please refrain from this, as continued violations may lead to account suspension.",
		reason: flaggedFor("repeated or unwanted messaging"),
		details:
			"Please slow down. Sending too many messages in a short time violates our guidelines. This system helps keep Grindr safe and positive for everyone. Continued behavior like this may result in your account being suspended. Always respect other users — read profiles for preferences, share your boundaries, and honor others’ limits.",
		guideline: "harassment",
	},
	drug_solicitation: {
		codes: ["DRUG_SOLICITATION"],
		title: "Occasional drug solicitation",
		content: "Seeking drugs on Grindr violates our guidelines. Please avoid this to help maintain a safe and respectful community.",
		reason: flaggedFor("occasional drug solicitation"),
		details:
			"Seeking drugs, even occasionally, in your profile or chats is not permitted. This goes against Grindr’s guidelines, as we care about your well-being and strive to maintain a safe, respectful community. Please avoid such mentions moving forward.",
		guideline: "obey_the_law",
	},
	drug_promotion: {
		codes: ["DRUG_PROMOTION"],
		title: "Drug promotion or glorification",
		content: "We do not allow activity promoting illegal drug use. If this happens again, your account could be suspended.",
		reason: flaggedFor("drug promotion or glorification"),
		details:
			"We care deeply about the well-being of our users. References to cannabis, tobacco, and alcohol are allowed in certain contexts, but we do not allow profiles centered around or promoting drug content, including discussing or participating in the buying or selling of drugs (of any kind). This policy also extends to images and emojis that solicit drugs or promote drug use.",
		guideline: "obey_the_law",
	},
	non_illicit_substances: {
		codes: ["NON_ILLICIT_SUBSTANCES"],
		title: "Casual mentions of legal or non-illicit substances",
		content:
			"Non-illicit substances like CBD or marijuana (where legal) are okay to mention on Grindr. However, excessive promotion or focus on these substances may lead to your account being reported by our community, and even suspended.",
		reason: flaggedFor("casual mentions of legal or non-illicit substances and symbols"),
		details:
			"We allow casual mentions of non-illicit substances, such as CBD, marijuana (where legal) on Grindr. However, profiles centered around these substances or excessive promotion of them can detract from the community experience and may be reported by other users. We care deeply about the well-being of our community and prohibit drug-related content or imagery that could promote harmful practices. Please ensure your profile aligns with our guidelines to help us maintain a safe and respectful platform for everyone.",
		guideline: "obey_the_law",
	},
	mild_solicitation: {
		codes: ["MILD_SOLICITATIONS", "MILD_SOLICITATION"],
		title: "Mild solicitation and casual offers",
		content:
			"Grindr is for genuine personal connections. Financial solicitations can blur boundaries and aren’t in line with our guidelines. Let’s keep interactions authentic and respectful.",
		reason: flaggedFor("mild solicitation and casual offers"),
		details:
			"Grindr is for personal connections—not promoting paid content or financial arrangements. Please ensure your profile or messages align with our guidelines to keep Grindr a space for genuine interactions.",
	},
	drug_seeking: {
		codes: ["DRUG_SEEKING"],
		title: "Drug seeking",
		content:
			"Seeking drugs on Grindr violates our guidelines. Please avoid this to help maintain a safe and respectful community. If this happens again, your account could be suspended.",
		reason: flaggedFor("drug seeking"),
		details:
			"Seeking drugs, even occasionally, in your profile or chats is not permitted. This goes against Grindr’s guidelines, as we care about your well-being and strive to maintain a safe, respectful community. Please avoid such mentions moving forward.",
		guideline: "obey_the_law",
	},
	drug_facilitation: {
		codes: ["DRUG_FACILITATION"],
		title: "Drug facilitation",
		content: "Helping others obtain illegal drugs isn’t allowed on Grindr. If this happens again, your account could be suspended.",
		reason: flaggedFor("drug facilitation"),
		details:
			"Connecting others to illegal drugs — offering to share what you have, arranging a pickup, or putting someone in touch with a source — is not permitted, even when nothing is being sold. This goes against Grindr’s guidelines, as we care about your well-being and strive to maintain a safe, respectful community. Please avoid this moving forward.",
		guideline: "obey_the_law",
	},
	non_consensual_intimate_imagery: {
		codes: ["NON_CONSENSUAL_INTIMATE_IMAGERY"],
		title: "Non-consensual intimate imagery",
		content:
			"Sharing intimate images or videos of another person without their consent isn’t allowed on Grindr. If this happens again, your account could be suspended.",
		reason: flaggedFor("sharing non-consensual intimate imagery"),
		details:
			"Intimate images or videos of another person should only ever be shared with that person’s consent — and consent to take or receive an image isn’t consent to share it. This applies to edited and AI-generated images as well. This goes against Grindr’s guidelines, as we care about the safety and privacy of everyone in our community. Please avoid this moving forward.",
	},
};

interface BanReasonEntry {
	codes: string[];
	title: string;
	/** Always shown. */
	summary: string;
	/** Replaces `summary` for permanent bans where the suspension wording would be wrong. */
	summaryBanned?: string;
	/** Behind "Learn more". */
	details?: string;
	guideline?: keyof typeof GUIDELINES;
}

/**
 * Keyed by the i18n id under account_status.ban_reasons. The first code of
 * each entry is Grindr's banSubReason value (as Open Grind models it); the
 * others are spellings inferred from the official app's string names, so
 * the lookup stays lenient.
 */
const BAN_REASONS: Record<string, BanReasonEntry> = {
	blackmail: {
		codes: ["BLACKMAIL_AND_THREATS", "BLACKMAIL", "BLACKMAIL_HARASSMENT", "EXTORTION", "THREATS"],
		title: "Blackmail, extortion, and direct threats",
		summary: "Grindr strictly prohibits blackmail, extortion, and direct threats of harm. These behaviors endanger users and violate the guidelines, and may result in account bans.",
		details:
			"Blackmail, extortion, and direct threats of harm, including manipulation involving personal images or information, are strictly prohibited on Grindr. Such behavior endangers the safety of the community and goes against the guidelines.",
		guideline: "harassment",
	},
	bot_activity: {
		codes: ["BOT_ACTIVITY", "BOT_ACTIVITY_SPAM", "BOT", "AUTOMATED_ACTIVITY", "AUTOMATION"],
		title: "Automated/bot activity",
		summary:
			"Grindr cares about fostering genuine connections. Behaviors like sending mass messages, creating multiple profiles in bulk, or using tools to mimic real user actions are prohibited.",
		details:
			"This account was flagged for violating Grindr’s policy on automated activity. This behavior compromises the security and authenticity of the community and goes against the guidelines. If you believe this action was taken in error, you can submit an appeal in the official Grindr app.",
		guideline: "authentic",
	},
	bullying: {
		codes: ["BULLYING", "BULLYING_HARASSMENT", "HARASSMENT", "HARASSMENT_BULLYING"],
		title: "Targeted bullying and repeated abuse",
		summary:
			"Treat others with kindness on Grindr. Bullying, harassment, and intimidation are prohibited, as they create a hostile environment. Repeated abusive behavior may result in further actions against the account.",
		details:
			"Grindr is committed to creating a safe space for everyone. Repeated or targeted bullying violates the guidelines and disrupts the community experience. Please take this time to review the community guidelines and ensure your future interactions are respectful and supportive. Continued violations may lead to further action, including an account ban.",
		guideline: "harassment",
	},
	business_solicitation: {
		codes: ["BUSINESS_SOLICITATION", "COMMERCIAL"],
		title: "Business solicitation",
		summary:
			"Using Grindr to promote businesses, paid services, or events is not allowed. Please keep interactions personal and free from business or solicitation purposes.",
		details:
			"Grindr is designed for personal connections, not for recruiting or soliciting users for profit-driven ventures like promoting businesses, paid services, or events. Such activities detract from the platform’s purpose and go against the guidelines.",
	},
	casual_substances: {
		codes: ["CASUAL_SUBSTANCES_MENTION", "CASUAL_SUBSTANCES", "NON_ILLICIT_SUBSTANCES"],
		title: "Casual mentions of legal or non-illicit substances",
		summary:
			"Non-illicit substances like CBD or marijuana (where legal) are okay to mention on Grindr. However, excessive promotion or focus on these substances may lead to the account being reported by the community, and even suspended.",
		details:
			"Profiles centered around these substances or excessive promotion of them can detract from the community experience and may be reported by other users. Grindr prohibits drug-related content or imagery that could promote harmful practices.",
		guideline: "obey_the_law",
	},
	consent_violation: {
		codes: ["CONSENT_VIOLATION", "CONSENT_VIOLATIONS", "CONSENT"],
		title: "Consent violations",
		summary:
			"Consent isn’t only sexy, it’s mandatory – persistent sexual requests, coercive behavior, and all other behavior that disregards consent are prohibited on Grindr.",
		details:
			"Grindr encourages users to provide transparent and explicit consent in all interactions. Persistent sexual requests, coercive behavior, or any actions that disregard another user’s boundaries are prohibited. Such behavior can create an unsafe and uncomfortable environment, violating the community guidelines and the principles of respect and safety.",
		guideline: "harassment",
	},
	drug_facilitation: {
		codes: ["DRUG_FACILITATION"],
		title: "Drug facilitation",
		summary: "Helping others obtain illegal drugs isn’t allowed on Grindr. Continued violations may lead to an account ban.",
		summaryBanned: "Helping others obtain illegal drugs isn’t allowed on Grindr. This account has been banned following repeated violations.",
		details:
			"Connecting others to illegal drugs — offering to share what you have, arranging a pickup, or putting someone in touch with a source — is not permitted, even when nothing is being sold. This goes against Grindr’s guidelines, as Grindr cares about your well-being and strives to maintain a safe, respectful community.",
		guideline: "obey_the_law",
	},
	drug_promotion: {
		codes: ["DRUG_PROMOTION", "DRUG_PROMOTION_SOLICITATION"],
		title: "Drug promotion or glorification",
		summary: "Repeated attempts to promote drugs are not allowed on Grindr.",
		details:
			"References to cannabis, tobacco, and alcohol are allowed in certain contexts, but Grindr does not allow profiles centered around or promoting drug content, including discussing or participating in the buying or selling of drugs (of any kind). This policy also extends to images and emojis that solicit drugs or promote drug use.",
		guideline: "obey_the_law",
	},
	drug_seeking: {
		codes: ["DRUG_SEEKING"],
		title: "Drug seeking",
		summary: "Seeking drugs on Grindr violates the guidelines.",
		details:
			"Seeking drugs, even occasionally, in your profile or chats is not permitted. This goes against Grindr’s guidelines, as Grindr cares about your well-being and strives to maintain a safe, respectful community.",
		guideline: "obey_the_law",
	},
	occasional_drug_solicitation: {
		codes: ["OCCASIONAL_DRUG_SOLICITATION", "DRUG_SOLICITATION"],
		title: "Occasional drug solicitation",
		summary: "Seeking drugs on Grindr violates the guidelines.",
		details:
			"Seeking drugs, even occasionally, in your profile or chats is not permitted. This goes against Grindr’s guidelines, as Grindr cares about your well-being and strives to maintain a safe, respectful community.",
		guideline: "obey_the_law",
	},
	frequent_drug_solicitation: {
		codes: ["FREQUENT_DRUG_SOLICITATION"],
		title: "Frequent drug solicitation",
		summary: "Repeated attempts to seek drugs are not allowed on Grindr.",
		details:
			"Grindr is a platform for genuine personal connections. Repeated attempts to seek drugs, whether directly or indirectly, disrupt the community experience and violate the guidelines. If such behavior continues, it may result in a longer account suspension or even a ban.",
		guideline: "obey_the_law",
	},
	fraudulent_promotion: {
		codes: ["SCAMS_AND_PROMOTIONS", "SCAM_AND_PROMOTIONS", "FRAUDULENT_PROMOTION", "FRAUD", "SCAM"],
		title: "Scam and fraudulent promotions",
		summary: "Grindr strictly prohibits scams or schemes that exploit or harm others.",
		details:
			"This includes fraudulent schemes or deceptive behavior aimed at exploiting other users. Grindr takes the safety and security of its community seriously and does not tolerate such behavior.",
		guideline: "private_information",
	},
	general_advertising: {
		codes: ["GENERAL_ADVERTISING", "ADVERTISING", "ADVERTISING_ACTIVITY"],
		title: "General advertising and solicitation",
		summary:
			"Grindr is for authentic personal connections, not for advertising goods, services, or external platforms. Promotional content is not allowed in profiles or messages.",
		details:
			"Using profiles or messages to promote products, services, or share external links goes against the guidelines and disrupts the experience for others.",
		guideline: "private_information",
	},
	hate_speech: {
		codes: ["HATE_SPEECH", "HATE_SPEECH_HARASSMENT", "DISCRIMINATION"],
		title: "Hate speech and offensive content",
		summary:
			"Hate speech and discriminatory language are prohibited on Grindr. Repeated abusive interactions create a hostile environment. Continued violations may lead to further action, including an account ban.",
		details:
			"Grindr is committed to fostering an inclusive and respectful community. Hate speech and discriminatory language may create a hostile and unsafe environment for others. Please review the community guidelines and ensure your future interactions reflect respect and inclusivity.",
		guideline: "hate",
	},
	impersonation: {
		codes: ["IMPERSONATION", "IMPERSONATION_AND_MISUSE", "IDENTITY_MISUSE"],
		title: "Impersonation and identity misuse",
		summary:
			"Grindr prohibits impersonating others or creating profiles that falsely represent someone’s identity. This behavior violates the guidelines and may result in account bans.",
		details:
			"This includes using another person’s name, photos, or personal details. Impersonation undermines trust, compromises safety, and violates the guidelines.",
		guideline: "authentic",
	},
	mild_insults: {
		codes: ["MILD_INSULTS", "MILD_INSULTS_HARASSMENT"],
		title: "Mild insults and disrespect",
		summary:
			"Some chats you’ve sent have been flagged as potentially disrespectful. Please be kind on Grindr, and ensure your interactions remain respectful in alignment with the community guidelines.",
		details:
			"Grindr seeks to provide a space for respectful and authentic interactions. Comments that may seem unkind or disrespectful can negatively impact others and go against the community guidelines. Continued violations may result in account actions like suspension or ban.",
		guideline: "harassment",
	},
	mild_solicitation: {
		codes: ["MILD_SOLICITATION", "MILD_SOLICITATIONS", "MILD_SEXUAL_SOLICITATION"],
		title: "Mild solicitation and casual offers",
		summary:
			"Grindr is for genuine personal connections. Financial solicitations can blur boundaries and aren’t in line with the guidelines.",
		details: "Grindr is for personal connections—not promoting paid content or financial arrangements.",
	},
	non_consensual_intimate_imagery: {
		codes: ["NON_CONSENSUAL_INTIMATE_IMAGERY", "NCII"],
		title: "Non-consensual intimate imagery",
		summary: "Sharing intimate images or videos of another person without their consent isn’t allowed on Grindr. Continued violations may lead to an account ban.",
		summaryBanned: "Sharing intimate images or videos of another person without their consent isn’t allowed on Grindr.",
		details:
			"Intimate images or videos of another person should only ever be shared with that person’s consent — and consent to take or receive an image isn’t consent to share it. This applies to edited and AI-generated images as well.",
	},
	offline_incident: {
		codes: ["SERIOUS_OFFLINE_INCIDENT", "SERIOUS_OFFLINE_INCIDENTS", "OFFLINE_INCIDENT", "OFFLINE_INCIDENTS"],
		title: "Serious offline incidents",
		summary: "This account was banned following a report of harmful behavior. Safety and respect are non-negotiable on Grindr.",
		details: "Grindr takes these actions to protect the safety of its community and maintain a respectful environment for all users.",
		guideline: "hate",
	},
	paid_sexual_services: {
		codes: ["PAID_SEXUAL_SERVICES", "SEX_WORK", "PROSTITUTION", "ESCORTING"],
		title: "Paid sexual services",
		summary: "Offering or requesting sexual services for money or compensation is not allowed on Grindr.",
		details:
			"Grindr is for personal connections, not for commercial transactions. Offering or requesting sexual services for compensation, no matter the circumstances, violates the guidelines.",
	},
	phishing: {
		codes: ["PHISHING", "PHISHING_SPAM", "PHISHING_AND_FRAUD", "MALWARE", "MALICIOUS_LINKS"],
		title: "Phishing, fraud, and harmful links",
		summary: "Grindr strictly prohibits sharing malicious links, phishing attempts, or harmful software.",
		details:
			"Sharing malicious links, phishing attempts, or harmful software can deceive others or compromise their security. Accounts engaging in such activities may be banned to protect the platform and its users.",
		guideline: "private_information",
	},
	privacy_violation: {
		codes: ["PRIVACY_VIOLATION", "PRIVACY_VIOLATIONS", "DOXXING", "DOXING"],
		title: "Privacy violations and doxxing",
		summary: "Sharing someone’s personal information without their permission is strictly forbidden and compromises safety.",
		details:
			"Sharing another person’s private or personal information, such as contact details or identifying information, without their permission is a serious violation of the guidelines. This behavior puts others at risk and undermines the trust within the community.",
		guideline: "private_information",
	},
	profile_spam: {
		codes: ["PROFILE_SPAM"],
		title: "Profile spam and advertising",
		summary:
			"Grindr is for authentic connections, not for promoting goods, services, or external platforms. Promotional content isn’t allowed in profiles or chats.",
		details:
			"Sharing ads, donation links, or event promotions in your profile or chats isn’t allowed and takes away from the authentic experience. Grindr is meant for genuine interactions—not selling services or hyping up events.",
		guideline: "private_information",
	},
	drug_sale: {
		codes: ["DRUG_SALES", "DRUG_SALE", "SELLING_DRUGS", "DRUG_SELLING"],
		title: "Drug sale and distribution",
		summary: "Grindr strictly prohibits any activity involving the sale or distribution of drugs. Accounts engaging in such behavior will be banned.",
		details:
			"Grindr does not allow profiles, chats, or content that facilitate the sale, distribution, or promotion of illegal substances. This policy is in place to support the well-being of users and to help maintain a safe, authentic environment for everyone, and violations of this nature are taken very seriously.",
		guideline: "obey_the_law",
	},
	sextortion: {
		codes: ["SEXTORTION"],
		title: "Sextortion",
		summary: "Threatening to share someone’s intimate images or videos isn’t allowed on Grindr.",
		details:
			"Blackmail, extortion, and direct threats of harm, including manipulation involving personal images or information, are strictly prohibited. Such behavior endangers the safety of the community.",
		guideline: "harassment",
	},
	sexual_content_sale: {
		codes: ["SEXUAL_CONTENT_SALE", "SALE_OF_SEXUAL_CONTENT", "SELLING_SEXUAL_CONTENT"],
		title: "Sale of sexually explicit content",
		summary:
			"Grindr is for making authentic connections, not for commercial transactions related to sexual content. Selling or promoting sexually explicit content (including your pictures or videos) is not allowed on Grindr.",
		details:
			"Selling or promoting sexually explicit material, including photos or videos, violates the guidelines and disrupts the community experience. Please ensure your profile and messages focus on building genuine connections within the community.",
	},
	spam: {
		codes: ["UNWANTED_MESSAGING", "SPAM"],
		title: "Repeated or unwanted messaging",
		summary:
			"Sending repeated messages or excessive follow-ups is considered spammy behavior. Continued violations may lead to account suspension.",
		details:
			"Sending too many messages in a short time violates the guidelines. Always respect other users — read profiles for preferences, share your boundaries, and honor others’ limits.",
		guideline: "harassment",
	},
	transactional_service: {
		codes: ["TRANSACTIONAL_SERVICE", "TRANSACTIONAL_SERVICES"],
		title: "Transactional services",
		summary: "Grindr prohibits offering or requesting transactional services, such as paid companionship, even when non-sexual in nature.",
		details:
			"These behaviors shift the platform away from its focus on personal, meaningful connections and violate the guidelines. Please ensure your interactions remain free from commercial intent.",
	},
	underage_endangerment: {
		codes: ["UNDERAGE_ENDANGERMENT", "CHILD_ENDANGERMENT", "MINOR_ENDANGERMENT"],
		title: "Child protection and endangerment",
		summary: "This account was banned following a report of harmful behavior. Safety and respect are non-negotiable on Grindr.",
		guideline: "minors",
	},
	underage_impersonation: {
		codes: ["UNDERAGE_IMPERSONATION"],
		title: "Underage impersonation",
		summary:
			"Grindr is for adults only – you must be at least 18 years (or older, in some regions) before you can use Grindr. Underage activity, even in role-playing contexts, is prohibited.",
		details:
			"Pretending to be a minor, whether for role-playing or any other reason, violates Grindr’s policies and may result in an account ban. Profiles impersonating other individuals, regardless of intent, undermine trust within the community and are not allowed.",
		guideline: "minors",
	},
	underage: {
		codes: ["UNDERAGE", "UNDERAGE_ACCESS", "UNDER_AGE", "MINOR", "AGE_RESTRICTED"],
		title: "Underage access",
		summary: "Grindr is for adults only – you must be at least 18 years (or older, in some regions) to use Grindr.",
		details:
			"You must meet this age requirement to use the services, and Grindr takes this rule very seriously. Additionally, communicating with minors or sharing any images involving minors, no matter the context, is a serious violation of Grindr’s policies.",
		guideline: "minors",
	},
};

export const BAN_APPEAL_URL = "https://web.grindr.com/ban-appeal";

export function openBanAppeal() {
	openUrl(BAN_APPEAL_URL).catch(() => window.open(BAN_APPEAL_URL, "_blank"));
}

// Timed bans only offer an appeal for these sub-reasons, as in the official app.
const APPEALABLE_TIMED_BANS = new Set([
	"UNDERAGE_ACCESS",
	"UNDERAGE_IMPERSONATION",
	"CHILD_ENDANGERMENT",
	"PHISHING_AND_FRAUD",
	"BOT_ACTIVITY",
	"DRUG_SALES",
	"PAID_SEXUAL_SERVICES",
	"BLACKMAIL_AND_THREATS",
	"PRIVACY_VIOLATIONS",
	"IMPERSONATION",
	"OFFLINE_INCIDENTS",
	"SCAMS_AND_PROMOTIONS",
]);

/**
 * Whether Grindr accepts an appeal: every permanent ban except one caused
 * by being blocked (BLOCK_DECISION), timed bans only for serious reasons.
 */
export function banOffersAppeal(subReason: string | null | undefined, permanent: boolean): boolean {
	const code = subReason ? normalizeCode(subReason) : null;
	if (permanent) return code !== "BLOCK_DECISION";
	return code != null && APPEALABLE_TIMED_BANS.has(code);
}

/** "Drug-Sales " / "drugSales" → "DRUG_SALES", so near-miss spellings still match. */
function normalizeCode(code: string): string {
	return code
		.trim()
		.replace(/([a-z])([A-Z])/g, "$1_$2")
		.replace(/[^A-Za-z0-9]+/g, "_")
		.replace(/^_|_$/g, "")
		.toUpperCase();
}

function findByCode<T extends { codes: string[] }>(table: Record<string, T>, code: string): [string, T] | null {
	const normalized = normalizeCode(code);
	for (const entry of Object.entries(table)) {
		if (entry[1].codes.includes(normalized)) return entry;
	}
	return null;
}

export interface GuidelineText {
	title: string;
	text: string;
}

function guidelineText(id: string | undefined, t: Translate): GuidelineText | null {
	const guideline = id ? GUIDELINES[id] : undefined;
	if (!id || !guideline) return null;
	return {
		title: t(`community_guidelines.${id}.title`, { defaultValue: guideline.title }),
		text: t(`community_guidelines.${id}.text`, { defaultValue: guideline.text }),
	};
}

export interface WarningText {
	title: string;
	content: string;
	reason: string;
	details: string | null;
	guideline: GuidelineText | null;
}

/** null for a warning code this version doesn't know; callers show the raw code then. */
export function warningText(code: string, t: Translate): WarningText | null {
	const match = findByCode(WARNING_TYPES, code);
	if (!match) return null;
	const [id, entry] = match;
	const key = `account_warnings.types.${id}`;
	return {
		title: t(`${key}.title`, { defaultValue: entry.title }),
		content: t(`${key}.content`, { defaultValue: entry.content }),
		reason: t(`${key}.reason`, { defaultValue: entry.reason }),
		details: entry.details ? t(`${key}.details`, { defaultValue: entry.details }) : null,
		guideline: guidelineText(entry.guideline, t),
	};
}

export interface BanReasonText {
	title: string;
	summary: string;
	details: string | null;
	guideline: GuidelineText | null;
}

/** Why the account was (temporarily) banned, from the first code that's known. */
export function banReasonText(codes: (string | null | undefined)[], permanent: boolean, t: Translate): BanReasonText | null {
	for (const code of codes) {
		if (!code) continue;
		const match = findByCode(BAN_REASONS, code);
		if (!match) continue;
		const [id, entry] = match;
		const key = `account_status.ban_reasons.${id}`;
		return {
			title: t(`${key}.title`, { defaultValue: entry.title }),
			summary:
				permanent && entry.summaryBanned
					? t(`${key}.summary_banned`, { defaultValue: entry.summaryBanned })
					: t(`${key}.summary`, { defaultValue: entry.summary }),
			details: entry.details ? t(`${key}.details`, { defaultValue: entry.details }) : null,
			guideline: guidelineText(entry.guideline, t),
		};
	}
	return null;
}

